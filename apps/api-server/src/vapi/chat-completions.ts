import { Router } from "express";
import { z } from "zod";
import pino from "pino";
import { config } from "../config.js";
import { TOOL_FUNCTION_DEFINITIONS } from "./tool-definitions.js";
import { convex } from "../convex-client.js";
import { anyApi } from "convex/server";

const log = pino({ name: "vapi-chat-completions" });
const api = anyApi;

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
- faq.search: Search knowledge base for answers
- order.lookup: Look up order details by order number
- account.lookup: Look up customer account
- ticket.create: Create a support ticket
- ticket.escalate: Escalate a ticket to a human
- account.update: Update customer account fields
- order.refund: Process a refund for an order`;

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

function sanitizeModelResponsePayload(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const choices = payload.choices;
  if (!Array.isArray(choices)) {
    return payload;
  }

  for (const choice of choices) {
    if (typeof choice !== "object" || choice === null) continue;
    const message = (choice as { message?: Record<string, unknown> }).message;
    if (!message || typeof message !== "object") continue;
    if (typeof message.content !== "string") continue;
    message.content = stripThinkBlocks(message.content);
  }

  return payload;
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

  // Build messages with system prompt + retrieved KB context.
  const resolvedSystemPrompt = await buildSystemPromptWithKnowledge(messages);
  const systemMessage = {
    role: "system" as const,
    content: resolvedSystemPrompt,
  };

  // Filter out any existing system messages from VAPI, inject ours
  const userMessages = messages.filter((m) => m.role !== "system");
  const fullMessages = [systemMessage, ...userMessages];

  try {
    // Proxy to MiniMax M2.5 (OpenAI-compatible endpoint)
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
        }),
      }
    );

    if (!minimaxResponse.ok) {
      const errorText = await minimaxResponse.text();
      log.error(
        { status: minimaxResponse.status, body: errorText },
        "MiniMax API error"
      );

      // Fallback: return a safe response instead of crashing
      res.json({
        id: `chatcmpl-fallback-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: config.MINIMAX_MODEL,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content:
                "I'm sorry, I'm having trouble processing that right now. Could you please repeat what you said?",
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
      return;
    }

    // Validate and forward MiniMax response
    const responseData = sanitizeModelResponsePayload(
      (await minimaxResponse.json()) as Record<string, unknown>
    );
    const firstChoice =
      Array.isArray(responseData.choices) &&
      responseData.choices.length > 0 &&
      typeof responseData.choices[0] === "object" &&
      responseData.choices[0] !== null
        ? (responseData.choices[0] as Record<string, unknown>)
        : null;
    const firstMessage =
      firstChoice &&
      typeof firstChoice.message === "object" &&
      firstChoice.message !== null
        ? (firstChoice.message as Record<string, unknown>)
        : null;

    log.info(
      {
        model: typeof responseData.model === "string" ? responseData.model : undefined,
        finishReason:
          firstChoice && typeof firstChoice.finish_reason === "string"
            ? firstChoice.finish_reason
            : undefined,
        hasToolCalls: Array.isArray(firstMessage?.tool_calls),
      },
      "MiniMax response"
    );

    // Return OpenAI-format response directly to VAPI
    res.json(responseData);
  } catch (err) {
    log.error({ err }, "Failed to proxy to MiniMax");

    // Graceful fallback per CLAUDE.md: if MiniMax fails, ask customer to repeat
    res.json({
      id: `chatcmpl-error-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: config.MINIMAX_MODEL,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content:
              "I didn't catch that, could you repeat? I'm having a brief technical issue.",
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  }
});

export { router as chatCompletionsRouter };
