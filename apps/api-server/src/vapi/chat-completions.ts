import { Router } from "express";
import { z } from "zod";
import pino from "pino";
import { config } from "../config.js";
import { TOOL_FUNCTION_DEFINITIONS } from "./tool-definitions.js";

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
- faq.search: Search knowledge base for answers
- order.lookup: Look up order details by order number
- account.lookup: Look up customer account
- ticket.create: Create a support ticket
- ticket.escalate: Escalate a ticket to a human
- account.update: Update customer account fields
- order.refund: Process a refund for an order`;

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

  // Build messages with our system prompt injected
  const systemMessage = { role: "system" as const, content: SYSTEM_PROMPT };

  // Filter out any existing system messages from VAPI, inject ours
  const userMessages = messages.filter((m) => m.role !== "system");
  const fullMessages = [systemMessage, ...userMessages];

  // TODO (Layer 3): Query Convex RAG for relevant knowledge based on latest user message
  // and append context to the system prompt

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
    const responseData = await minimaxResponse.json();

    log.info(
      {
        model: responseData.model,
        finishReason: responseData.choices?.[0]?.finish_reason,
        hasToolCalls: !!responseData.choices?.[0]?.message?.tool_calls,
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
