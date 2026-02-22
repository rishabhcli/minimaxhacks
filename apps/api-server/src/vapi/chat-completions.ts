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

RETURN/REFUND WORKFLOW:
When a customer mentions returning an item, wanting a refund, or having an issue with a purchase:
1. First use faq_search with query "return policy" to retrieve the current return policy
2. Use account_lookup to identify the customer (if not already known)
3. Use order_list with the customer's ID to find their orders
4. Once you identify the specific order, use order_lookup for full details
5. Explain the applicable return policy based on the item type and purchase date
6. If eligible, proceed with order_refund; if not, explain why and offer alternatives

KEY POLICY DETAILS (always verify with faq_search for latest):
- General returns: 30 days from delivery
- Electronics: 15 days, original packaging required
- Refund processing: 5-7 business days
- Return shipping: free for defective items, $9.99 fee for non-defective
- Late returns (past window): may be accepted with 15% restocking fee

AVAILABLE TOOLS:
- faq_search: Search knowledge base for policy answers. USE PROACTIVELY when the conversation involves returns, refunds, shipping, or account policies
- order_lookup: Look up order details by order number
- order_list: List all orders for a customer by customer ID. Use when customer wants to return/check an order but doesn't know the order number
- account_lookup: Look up customer account details
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

/**
 * Extract topic-aware search queries from the conversation.
 * Supplements the latest user message with domain-specific keywords
 * when return/refund/shipping/account scenarios are detected.
 */
function extractSearchQueries(
  messages: Array<z.infer<typeof MessageSchema>>
): string[] {
  const queries: string[] = [];

  const userTexts = messages
    .filter((m) => m.role === "user" && typeof m.content === "string")
    .map((m) => (m.content as string).toLowerCase());

  const allUserText = userTexts.join(" ");

  const latest = latestUserText(messages);
  if (latest) queries.push(latest);

  const returnKeywords = ["return", "refund", "send back", "exchange", "warranty",
    "defective", "broken", "damaged", "wrong item", "doesn't work", "not working"];
  if (returnKeywords.some((kw) => allUserText.includes(kw))) {
    queries.push("return policy refund");
  }

  const shippingKeywords = ["shipping", "delivery", "tracking", "when will", "arrive",
    "shipped", "transit", "delayed"];
  if (shippingKeywords.some((kw) => allUserText.includes(kw))) {
    queries.push("shipping information delivery");
  }

  const accountKeywords = ["account", "password", "email change", "delete account",
    "two-factor", "2fa", "settings"];
  if (accountKeywords.some((kw) => allUserText.includes(kw))) {
    queries.push("account management");
  }

  return [...new Set(queries)];
}

async function buildSystemPromptWithKnowledge(
  messages: Array<z.infer<typeof MessageSchema>>
): Promise<string> {
  const queries = extractSearchQueries(messages);
  if (queries.length === 0) return SYSTEM_PROMPT;

  try {
    const allResults = await Promise.all(
      queries.map((q) =>
        convex
          .query(api.knowledgeDocuments.search, { query: q })
          .catch(() => [] as KnowledgeDoc[])
      )
    );

    const seen = new Set<string>();
    const uniqueDocs: KnowledgeDoc[] = [];
    for (const docs of allResults) {
      for (const doc of Array.isArray(docs) ? docs : []) {
        const key = doc.title ?? doc.content?.slice(0, 50) ?? "";
        if (!seen.has(key)) {
          seen.add(key);
          uniqueDocs.push(doc);
        }
      }
    }

    const kbContext = buildKbContext(uniqueDocs);

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
