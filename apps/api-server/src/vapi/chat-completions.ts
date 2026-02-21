import { Router } from "express";
import { z } from "zod";
import pino from "pino";
import { config } from "../config.js";
import { TOOL_FUNCTION_DEFINITIONS } from "./tool-definitions.js";
import { convex } from "../convex-client.js";
import { anyApi } from "convex/server";

const api = anyApi;

const log = pino({ name: "vapi-chat-completions" });

const router = Router();

// ── Zod schemas for VAPI → us ──

const MessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "function", "tool"]),
  content: z.string().nullable().optional(),
  name: z.string().optional(),
  tool_calls: z
    .array(
      z.object({
        id: z.string(),
        type: z.literal("function"),
        function: z.object({
          name: z.string(),
          arguments: z.string(),
        }),
      })
    )
    .optional(),
  tool_call_id: z.string().optional(),
});

const ChatCompletionRequestSchema = z.object({
  model: z.string().optional(),
  messages: z.array(MessageSchema),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  stream: z.boolean().optional(),
  call: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ── System prompt ──

const SYSTEM_PROMPT = `You are ShieldDesk, an AI customer support agent. You help customers with orders, refunds, account issues, and general questions.

IMPORTANT RULES:
- Be helpful, professional, and empathetic
- Use available tools to look up information and take actions
- Some actions may require approval based on security policy — if a tool call is escalated or denied, explain this to the customer clearly
- Never fabricate order numbers, customer IDs, or other data — always use tools to look up real information
- If you're unsure what the customer needs, ask clarifying questions
- Keep responses concise and conversational (this is a voice call)

AVAILABLE TOOLS:
- faq_search: Search knowledge base for answers
- order_lookup: Look up order details by order number
- account_lookup: Look up customer account
- ticket_create: Create a support ticket
- ticket_escalate: Escalate a ticket to a human
- account_update: Update customer account fields
- order_refund: Process a refund for an order`;

type KnowledgeDoc = {
  title?: string;
  content?: string;
  sourceUrl?: string;
};

function stripThinkBlocks(content: string): string {
  const cleaned = content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
  return cleaned.length > 0
    ? cleaned
    : "I can help with that. Could you share a bit more detail?";
}

function latestUserText(
  messages: Array<z.infer<typeof MessageSchema>>
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === "user" && typeof msg.content === "string") {
      const text = msg.content.trim();
      if (text.length > 0) return text;
    }
  }
  return null;
}

function buildKbContext(docs: KnowledgeDoc[]): string {
  if (docs.length === 0) {
    return "No relevant knowledge documents were retrieved for this turn.";
  }

  return docs
    .slice(0, 5)
    .map((doc, idx) => {
      const title = doc.title ?? `Document ${idx + 1}`;
      const source = doc.sourceUrl ?? "unknown-source";
      const snippet = (doc.content ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 400);
      return `[${idx + 1}] ${title}\nSource: ${source}\nSnippet: ${snippet}`;
    })
    .join("\n\n");
}

async function buildSystemPromptWithKnowledge(
  messages: Array<z.infer<typeof MessageSchema>>
): Promise<string> {
  const userText = latestUserText(messages);
  if (!userText) return SYSTEM_PROMPT;

  try {
    const docs = (await convex.query(api.knowledgeDocuments.search, {
      query: userText,
    })) as KnowledgeDoc[];
    const kbContext = buildKbContext(Array.isArray(docs) ? docs : []);

    return `${SYSTEM_PROMPT}

KNOWLEDGE CONTEXT (retrieved from ShieldDesk KB):
${kbContext}

GROUNDING RULES:
- Prioritize retrieved context for factual support policies/processes.
- If context is insufficient, say so and ask a clarifying question or use a tool.
- Do not invent policy details not present in context or tool results.`;
  } catch (err) {
    log.warn({ err }, "RAG lookup failed, proceeding without KB context");
    return SYSTEM_PROMPT;
  }
}

// ── POST /vapi/chat/completions ──

router.post("/chat/completions", async (req, res) => {
  const parseResult = ChatCompletionRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    log.warn({ errors: parseResult.error.issues }, "Invalid request body");
    res.status(400).json({
      error: {
        message: "Invalid request body",
        details: parseResult.error.issues,
      },
    });
    return;
  }

  const { messages, temperature, max_tokens, call, metadata } =
    parseResult.data;

  log.info(
    {
      messageCount: messages.length,
      callId: call?.id,
      lastRole: messages[messages.length - 1]?.role,
    },
    "Chat completion request from VAPI"
  );

  // Build system prompt with RAG context (pre-computed before stream starts)
  const resolvedSystemPrompt = await buildSystemPromptWithKnowledge(messages);

  // Filter out any existing system messages from VAPI, inject ours
  const userMessages = messages.filter((m) => m.role !== "system");
  const systemMessage = {
    role: "system" as const,
    content: resolvedSystemPrompt,
  };
  const fullMessages = [systemMessage, ...userMessages];

  const wantsStream = parseResult.data.stream === true;

  try {
    // Stream from MiniMax and pipe to VAPI in real-time to avoid timeout
    const minimaxResponse = await fetch(
      `${config.MINIMAX_BASE_URL}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.MINIMAX_API_KEY}`,
        },
        body: JSON.stringify({
          model: config.MINIMAX_MODEL,
          messages: fullMessages,
          tools: TOOL_FUNCTION_DEFINITIONS,
          temperature: temperature ?? 0.7,
          max_tokens: max_tokens ?? 1024,
          stream: true,
        }),
      }
    );

    if (!minimaxResponse.ok) {
      const errorText = await minimaxResponse.text();
      log.error(
        { status: minimaxResponse.status, body: errorText },
        "MiniMax API error"
      );
      return sendFallback(res, wantsStream, config.MINIMAX_MODEL,
        "I'm sorry, I'm having trouble processing that right now. Could you please repeat what you said?");
    }

    const body = minimaxResponse.body;
    if (!body) throw new Error("No response body from MiniMax");

    // Set SSE headers immediately so VAPI knows we're alive
    if (wantsStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = "";
    let insideThink = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: [DONE]")) {
            if (wantsStream) res.write("data: [DONE]\n\n");
            continue;
          }
          if (!line.startsWith("data: ")) continue;

          try {
            const parsed = JSON.parse(line.slice(6));
            const choice = parsed.choices?.[0];
            if (!choice?.delta) {
              if (wantsStream) res.write(`data: ${JSON.stringify(parsed)}\n\n`);
              continue;
            }

            // Strip <think>...</think> from content in real-time
            if (typeof choice.delta.content === "string") {
              let c = choice.delta.content;
              if (c.includes("<think>")) {
                insideThink = true;
                c = c.replace(/<think>[\s\S]*/g, "");
              }
              if (insideThink && c.includes("</think>")) {
                insideThink = false;
                c = c.replace(/[\s\S]*<\/think>\s*/g, "");
              }
              if (insideThink) c = "";
              choice.delta.content = c;
            }

            // Always forward tool_calls and finish_reason
            const hasUseful = choice.delta.content || choice.delta.tool_calls || choice.finish_reason;
            if (!hasUseful) continue;

            if (wantsStream) {
              res.write(`data: ${JSON.stringify(parsed)}\n\n`);
            }
          } catch { /* skip bad lines */ }
        }
      }

      // Flush remaining buffer
      if (sseBuffer.trim()) {
        if (sseBuffer.startsWith("data: [DONE]")) {
          if (wantsStream) res.write("data: [DONE]\n\n");
        } else if (sseBuffer.startsWith("data: ")) {
          try {
            const parsed = JSON.parse(sseBuffer.slice(6));
            if (wantsStream) res.write(`data: ${JSON.stringify(parsed)}\n\n`);
          } catch { /* skip */ }
        }
      }

      if (wantsStream) {
        res.write("data: [DONE]\n\n");
        res.end();
      }
    } catch (streamErr) {
      log.error({ err: streamErr }, "Stream error");
      if (wantsStream && !res.writableEnded) res.end();
    }

    log.info("Streamed MiniMax→VAPI (real-time, thinking stripped)");
  } catch (err) {
    log.error({ err }, "Failed to proxy to MiniMax");
    sendFallback(res, wantsStream, config.MINIMAX_MODEL,
      "I didn't catch that, could you repeat? I'm having a brief technical issue.");
  }
});

/** Send a graceful fallback response in either SSE or JSON format */
function sendFallback(
  res: import("express").Response,
  stream: boolean,
  model: string,
  message: string
) {
  if (stream) {
    if (!res.headersSent) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
    }
    const chunk = {
      id: `chatcmpl-fallback-${Date.now()}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: { role: "assistant", content: message }, finish_reason: "stop" }],
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  } else {
    res.json({
      id: `chatcmpl-fallback-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message: { role: "assistant", content: message }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  }
}

export { router as chatCompletionsRouter };
