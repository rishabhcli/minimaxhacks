import { Router } from "express";
import { z } from "zod";
import pino from "pino";
import { config } from "../config.js";
import { TOOL_FUNCTION_DEFINITIONS } from "./tool-definitions.js";
import { analyzeSentiment, setSentiment, getSentiment } from "./sentiment.js";
import { resolveGovernanceContext } from "./governance-context.js";
import {
  ensureConversation,
  recordMessage,
  updateConversationSentiment,
} from "../conversation-audit.js";

const log = pino({ name: "vapi-chat-completions" });

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

interface ChatCompletionsDeps {
  resolveGovernanceContext: typeof resolveGovernanceContext;
  getSentiment: typeof getSentiment;
  setSentiment: typeof setSentiment;
  analyzeSentiment: typeof analyzeSentiment;
  ensureConversation: typeof ensureConversation;
  recordMessage: typeof recordMessage;
  updateConversationSentiment: typeof updateConversationSentiment;
  allowClientGovernanceOverrides: boolean;
  fetchImpl: typeof fetch;
  now: () => number;
}

const defaultDeps: ChatCompletionsDeps = {
  resolveGovernanceContext,
  getSentiment,
  setSentiment,
  analyzeSentiment,
  ensureConversation,
  recordMessage,
  updateConversationSentiment,
  allowClientGovernanceOverrides: config.ALLOW_CLIENT_GOVERNANCE_OVERRIDES,
  fetchImpl: fetch,
  now: () => Date.now(),
};

function stripThinkingContent(content: string): string {
  return content
    .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
    .replace(/<think>[\s\S]*$/g, "")
    .replace(/^[\s\S]*<\/think>\s*/g, "");
}

function buildMiniMaxRequestBody(
  messages: typeof MessageSchema._type[],
  temperature: number | undefined,
  maxTokens: number | undefined,
  stream: boolean
) {
  return {
    model: config.MINIMAX_MODEL,
    messages,
    tools: TOOL_FUNCTION_DEFINITIONS,
    temperature: temperature ?? 0.7,
    max_tokens: maxTokens ?? 1024,
    stream,
  };
}

// ── POST /vapi/chat/completions ──

export function createChatCompletionsRouter(
  overrides: Partial<ChatCompletionsDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  const router = Router();

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

    const userMessages = messages.filter((m) => m.role !== "system");
    const sessionMeta = metadata ?? {};
    const callId = typeof call?.id === "string" ? call.id : undefined;
    const detectedSentiment = callId ? deps.getSentiment(callId) : "neutral";
    const { trustLevel, sentiment, customerId } = deps.resolveGovernanceContext({
      sessionMeta,
      detectedSentiment,
      allowClientOverrides: deps.allowClientGovernanceOverrides,
    });
    let conversationId: string | undefined;

    if (callId) {
      try {
        conversationId = await deps.ensureConversation({
          channelType: "vapi_web",
          channelSessionId: callId,
          customerId,
          trustLevel,
          sentimentScore: sentiment,
        });
      } catch (err) {
        log.warn(
          { err, callId },
          "Failed to ensure conversation before chat completion"
        );
      }
    }

    const latestUserMsg = [...userMessages].reverse().find((m) => m.role === "user");
    if (conversationId && latestUserMsg?.content) {
      try {
        await deps.recordMessage(conversationId, "customer", latestUserMsg.content);
      } catch (err) {
        log.warn({ err, conversationId }, "Failed to persist customer transcript");
      }
    }

    if (callId && latestUserMsg?.content) {
      deps
        .analyzeSentiment(latestUserMsg.content)
        .then((nextSentiment) => {
          const previousSentiment = deps.getSentiment(callId);
          if (nextSentiment !== previousSentiment) {
            log.info(
              { callId, prev: previousSentiment, sentiment: nextSentiment },
              "Sentiment changed"
            );
            deps.setSentiment(callId, nextSentiment);
            if (conversationId) {
              deps
                .updateConversationSentiment(
                  conversationId,
                  previousSentiment,
                  nextSentiment
                )
                .catch((err) => {
                  log.warn(
                    { err, conversationId, callId },
                    "Failed to persist sentiment change"
                  );
                });
            }
          }
        })
        .catch(() => {
          // sentiment is best-effort
        });
    }

    const systemMessage = {
      role: "system" as const,
      content: SYSTEM_PROMPT,
    };
    const fullMessages = [systemMessage, ...userMessages];
    const wantsStream = parseResult.data.stream === true;

    try {
      const minimaxResponse = await deps.fetchImpl(
        `${config.MINIMAX_BASE_URL}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.MINIMAX_API_KEY}`,
          },
          body: JSON.stringify(
            buildMiniMaxRequestBody(
              fullMessages,
              temperature,
              max_tokens,
              wantsStream
            )
          ),
        }
      );

      if (!minimaxResponse.ok) {
        const errorText = await minimaxResponse.text();
        log.error(
          { status: minimaxResponse.status, body: errorText },
          "MiniMax API error"
        );
        sendFallback(
          res,
          wantsStream,
          config.MINIMAX_MODEL,
          "I'm sorry, I'm having trouble processing that right now. Could you please repeat what you said?",
          deps.now
        );
        return;
      }

      if (!wantsStream) {
        const payload = (await minimaxResponse.json()) as {
          choices?: Array<{
            message?: {
              role?: string;
              content?: string | null;
              tool_calls?: unknown;
            };
            finish_reason?: string | null;
          }>;
          usage?: unknown;
          id?: string;
          object?: string;
          created?: number;
          model?: string;
        };

        const assistantMessage = payload.choices?.[0]?.message;
        const sanitizedContent = stripThinkingContent(
          typeof assistantMessage?.content === "string"
            ? assistantMessage.content
            : ""
        ).trim();

        if (conversationId && sanitizedContent) {
          try {
            await deps.recordMessage(conversationId, "agent", sanitizedContent);
          } catch (err) {
            log.warn({ err, conversationId }, "Failed to persist agent transcript");
          }
        }

        res.json({
          id: payload.id ?? `chatcmpl-${deps.now()}`,
          object: payload.object ?? "chat.completion",
          created: payload.created ?? Math.floor(deps.now() / 1000),
          model: payload.model ?? config.MINIMAX_MODEL,
          choices: [
            {
              index: 0,
              message: {
                role: assistantMessage?.role ?? "assistant",
                content: sanitizedContent,
                ...(assistantMessage?.tool_calls
                  ? { tool_calls: assistantMessage.tool_calls }
                  : {}),
              },
              finish_reason: payload.choices?.[0]?.finish_reason ?? "stop",
            },
          ],
          usage:
            payload.usage ?? {
              prompt_tokens: 0,
              completion_tokens: 0,
              total_tokens: 0,
            },
        });
        return;
      }

      const body = minimaxResponse.body;
      if (!body) throw new Error("No response body from MiniMax");

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";
      let insideThink = false;
      let assistantText = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });

          const lines = sseBuffer.split("\n");
          sseBuffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data: [DONE]")) {
              res.write("data: [DONE]\n\n");
              continue;
            }
            if (!line.startsWith("data: ")) continue;

            try {
              const parsed = JSON.parse(line.slice(6));
              const choice = parsed.choices?.[0];
              if (!choice?.delta) {
                res.write(`data: ${JSON.stringify(parsed)}\n\n`);
                continue;
              }

              if (typeof choice.delta.content === "string") {
                let content = choice.delta.content;
                if (content.includes("<think>")) {
                  insideThink = true;
                  content = content.replace(/<think>[\s\S]*/g, "");
                }
                if (insideThink && content.includes("</think>")) {
                  insideThink = false;
                  content = content.replace(/[\s\S]*<\/think>\s*/g, "");
                }
                if (insideThink) content = "";
                choice.delta.content = content;
                assistantText += content;
              }

              const hasUseful =
                choice.delta.content || choice.delta.tool_calls || choice.finish_reason;
              if (!hasUseful) continue;

              res.write(`data: ${JSON.stringify(parsed)}\n\n`);
            } catch {
              // Skip malformed provider frames.
            }
          }
        }

        if (sseBuffer.trim()) {
          if (sseBuffer.startsWith("data: [DONE]")) {
            res.write("data: [DONE]\n\n");
          } else if (sseBuffer.startsWith("data: ")) {
            try {
              const parsed = JSON.parse(sseBuffer.slice(6));
              const content = parsed.choices?.[0]?.delta?.content;
              if (typeof content === "string") {
                assistantText += stripThinkingContent(content);
              }
              res.write(`data: ${JSON.stringify(parsed)}\n\n`);
            } catch {
              // Skip malformed trailing chunk.
            }
          }
        }

        if (conversationId && assistantText.trim()) {
          try {
            await deps.recordMessage(conversationId, "agent", assistantText.trim());
          } catch (err) {
            log.warn({ err, conversationId }, "Failed to persist agent transcript");
          }
        }

        res.write("data: [DONE]\n\n");
        res.end();
      } catch (streamErr) {
        log.error({ err: streamErr }, "Stream error");
        if (!res.writableEnded) res.end();
      }

      log.info("Streamed MiniMax→VAPI (real-time, thinking stripped)");
    } catch (err) {
      log.error({ err }, "Failed to proxy to MiniMax");
      sendFallback(
        res,
        wantsStream,
        config.MINIMAX_MODEL,
        "I didn't catch that, could you repeat? I'm having a brief technical issue.",
        deps.now
      );
    }
  });

  return router;
}

/** Send a graceful fallback response in either SSE or JSON format */
function sendFallback(
  res: import("express").Response,
  stream: boolean,
  model: string,
  message: string,
  now: () => number
) {
  if (stream) {
    if (!res.headersSent) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
    }
    const chunk = {
      id: `chatcmpl-fallback-${now()}`,
      object: "chat.completion.chunk",
      created: Math.floor(now() / 1000),
      model,
      choices: [{ index: 0, delta: { role: "assistant", content: message }, finish_reason: "stop" }],
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  } else {
    res.json({
      id: `chatcmpl-fallback-${now()}`,
      object: "chat.completion",
      created: Math.floor(now() / 1000),
      model,
      choices: [{ index: 0, message: { role: "assistant", content: message }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  }
}

export const chatCompletionsRouter = createChatCompletionsRouter();
