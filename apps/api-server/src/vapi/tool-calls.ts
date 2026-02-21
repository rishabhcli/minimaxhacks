import { Router } from "express";
import { z } from "zod";
import pino from "pino";
import { executeWithGovernance } from "../policy/executor.js";
import type { Sentiment, TrustLevel } from "@shielddesk/shared";
import { convex } from "../convex-client.js";
import { anyApi } from "convex/server";

const log = pino({ name: "vapi-tool-calls" });
const api = anyApi;

const router = Router();

// ── Zod schema for VAPI tool-calls webhook ──

const ToolCallItemSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    arguments: z.union([z.record(z.unknown()), z.string()]),
  }),
});

const VapiToolCallWebhookSchema = z.object({
  message: z.object({
    type: z.literal("tool-calls"),
    toolCallList: z.array(ToolCallItemSchema),
    call: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
});

type ActionStatus =
  | "executed"
  | "escalated"
  | "blocked"
  | "failed";

function toStoredResultText(stored: unknown): string | null {
  if (typeof stored === "string") return stored;
  if (stored && typeof stored === "object") {
    const response = (stored as Record<string, unknown>).response;
    if (typeof response === "string") return response;
  }
  return null;
}

function statusForDecision(decision: "allow" | "deny" | "escalate"): ActionStatus {
  if (decision === "allow") return "executed";
  if (decision === "escalate") return "escalated";
  return "blocked";
}

type ConversationRecord = {
  _id: string;
  customerId?: string;
  trustLevel?: number;
  sentimentScore?: string;
};

// ── POST /vapi/tool-calls ──

router.post("/tool-calls", async (req, res) => {
  // VAPI sends ALL webhook events to serverUrl, not just tool-calls.
  // Gracefully ignore non-tool-call events (status-update, speech-update,
  // conversation-update, assistant.started, hang, end-of-call-report, etc.)
  const messageType = req.body?.message?.type;
  if (messageType && messageType !== "tool-calls") {
    log.debug({ type: messageType }, "Ignoring non-tool-call VAPI event");
    res.status(200).json({ ok: true });
    return;
  }

  const parseResult = VapiToolCallWebhookSchema.safeParse(req.body);
  if (!parseResult.success) {
    log.warn({ errors: parseResult.error.issues }, "Invalid tool-calls payload");
    res.status(400).json({
      error: { message: "Invalid payload", details: parseResult.error.issues },
    });
    return;
  }

  const { message } = parseResult.data;
  const { toolCallList, call, metadata } = message;
  const callId = typeof call?.id === "string" ? call.id : "unknown-call";

  log.info(
    {
      toolCount: toolCallList.length,
      tools: toolCallList.map((tc) => tc.function.name),
      callId,
    },
    "Tool-calls webhook from VAPI"
  );

  // Extract session context from metadata (set by VAPI widget via assistantOverrides)
  const sessionMeta = metadata ?? {};
  let trustLevel = (
    typeof sessionMeta.trustLevel === "number"
      ? sessionMeta.trustLevel
      : 2
  ) as TrustLevel;
  let sentiment = (
    typeof sessionMeta.sentiment === "string"
      ? sessionMeta.sentiment
      : "neutral"
  ) as Sentiment;
  let conversationId =
    typeof sessionMeta.conversationId === "string"
      ? sessionMeta.conversationId
      : undefined;
  let customerId =
    typeof sessionMeta.customerId === "string"
      ? sessionMeta.customerId
      : undefined;

  if (!conversationId && callId !== "unknown-call") {
    try {
      const conv = (await convex.query(api.conversations.getBySessionId, {
        channelSessionId: callId,
      })) as ConversationRecord | null;
      if (conv?._id) {
        conversationId = conv._id;
      }
    } catch (err) {
      log.warn({ err, callId }, "Failed to resolve conversation by call ID");
    }
  }

  if (conversationId) {
    try {
      const conv = (await convex.query(api.conversations.getById, {
        id: conversationId,
      })) as ConversationRecord | null;
      if (conv) {
        if (!customerId && conv.customerId) {
          customerId = conv.customerId;
        }
        if (
          typeof sessionMeta.trustLevel !== "number" &&
          typeof conv.trustLevel === "number"
        ) {
          trustLevel = conv.trustLevel as TrustLevel;
        }
        if (
          typeof sessionMeta.sentiment !== "string" &&
          typeof conv.sentimentScore === "string"
        ) {
          sentiment = conv.sentimentScore as Sentiment;
        }
      }
    } catch (err) {
      log.warn({ err, conversationId }, "Failed to load conversation context");
    }
  }

  // Process each tool call through governance
  const results = await Promise.all(
    toolCallList.map(async (toolCall) => {
      const toolName = toolCall.function.name;
      const idempotencyKey = `${callId}:${toolCall.id}:${toolName}`;

      // Parse arguments — VAPI may send as string or object
      let toolArgs: Record<string, unknown>;
      if (typeof toolCall.function.arguments === "string") {
        try {
          toolArgs = JSON.parse(toolCall.function.arguments);
        } catch {
          log.warn(
            { raw: toolCall.function.arguments },
            "Failed to parse tool arguments"
          );
          return {
            toolCallId: toolCall.id,
            result: JSON.stringify({
              error: "I had trouble understanding that request. Could you try again?",
            }),
          };
        }
      } else {
        toolArgs = toolCall.function.arguments;
      }

      // Default confidence — in production, this comes from MiniMax intent extraction
      const confidence = typeof sessionMeta.confidence === "number"
        ? sessionMeta.confidence
        : 0.90;

      try {
        const existing = await convex.query(api.agentActions.byIdempotencyKey, {
          idempotencyKey,
        });
        if (existing) {
          const replayResult =
            toStoredResultText(existing.result) ??
            JSON.stringify({
              replayed: true,
              decision: existing.policyDecision ?? "unknown",
              message:
                existing.policyReason ??
                "This request was already processed.",
            });

          log.info(
            { idempotencyKey, toolName },
            "Returning idempotent replay result"
          );
          return {
            toolCallId: toolCall.id,
            result: replayResult,
          };
        }

        const govResult = await executeWithGovernance({
          toolName,
          toolArgs,
          confidence,
          sentiment,
          trustLevel,
          conversationId,
          customerId,
        });

        log.info(
          {
            toolName,
            decision: govResult.decision,
            riskScore: govResult.riskScore,
            effectiveThreshold: govResult.effectiveThreshold,
          },
          "Governance result"
        );

        if (govResult.decision === "allow") {
          // Tool was executed — return result
          const resultContent =
            govResult.toolResult &&
            typeof govResult.toolResult === "object" &&
            "content" in (govResult.toolResult as Record<string, unknown>)
              ? (
                  (govResult.toolResult as { content: Array<{ text: string }> })
                  .content[0]?.text ?? "{}"
                )
              : JSON.stringify(govResult.toolResult ?? {});

          await convex.mutation(api.agentActions.log, {
            conversationId,
            customerId,
            toolName,
            toolArgs,
            status: statusForDecision(govResult.decision),
            confidence,
            riskScore: govResult.riskScore,
            effectiveThreshold: govResult.effectiveThreshold,
            sentimentAtTime: sentiment,
            policyDecision: govResult.decision,
            policyReason: govResult.reason,
            armoriqTokenId: govResult.armoriqTokenId,
            armoriqPlanHash: govResult.armoriqPlanHash,
            armoriqVerified: govResult.armoriqVerified,
            result: { response: resultContent },
            idempotencyKey,
          });

          return {
            toolCallId: toolCall.id,
            result: resultContent,
          };
        }

        if (govResult.decision === "escalate") {
          const escalatedResult = JSON.stringify({
            escalated: true,
            message: `This action requires additional verification. ${govResult.reason}. I've flagged this for a human agent to review.`,
          });

          await convex.mutation(api.agentActions.log, {
            conversationId,
            customerId,
            toolName,
            toolArgs,
            status: statusForDecision(govResult.decision),
            confidence,
            riskScore: govResult.riskScore,
            effectiveThreshold: govResult.effectiveThreshold,
            sentimentAtTime: sentiment,
            policyDecision: govResult.decision,
            policyReason: govResult.reason,
            armoriqTokenId: govResult.armoriqTokenId,
            armoriqPlanHash: govResult.armoriqPlanHash,
            armoriqVerified: govResult.armoriqVerified,
            result: { response: escalatedResult },
            idempotencyKey,
          });

          return {
            toolCallId: toolCall.id,
            result: escalatedResult,
          };
        }

        // DENY
        const deniedResult = JSON.stringify({
          denied: true,
          message: `This action cannot be performed automatically. ${govResult.reason}.`,
        });

        await convex.mutation(api.agentActions.log, {
          conversationId,
          customerId,
          toolName,
          toolArgs,
          status: statusForDecision(govResult.decision),
          confidence,
          riskScore: govResult.riskScore,
          effectiveThreshold: govResult.effectiveThreshold,
          sentimentAtTime: sentiment,
          policyDecision: govResult.decision,
          policyReason: govResult.reason,
          armoriqTokenId: govResult.armoriqTokenId,
          armoriqPlanHash: govResult.armoriqPlanHash,
          armoriqVerified: govResult.armoriqVerified,
          result: { response: deniedResult },
          idempotencyKey,
        });

        return {
          toolCallId: toolCall.id,
          result: deniedResult,
        };
      } catch (err) {
        log.error({ err, toolName }, "Governance execution error");
        try {
          await convex.mutation(api.agentActions.log, {
            conversationId,
            customerId,
            toolName,
            toolArgs,
            status: "failed",
            confidence,
            sentimentAtTime: sentiment,
            errorMessage:
              err instanceof Error ? err.message : "Unknown governance error",
            idempotencyKey,
          });
        } catch (logErr) {
          log.error(
            { err: logErr, toolName, idempotencyKey },
            "Failed to persist failed action log"
          );
        }

        const failedResult = JSON.stringify({
          error: "I encountered an issue processing that request. Let me create a ticket for you instead.",
        });

        return {
          toolCallId: toolCall.id,
          result: failedResult,
        };
      }
    })
  );

  // Return results in VAPI expected format
  res.json({ results });
});

export { router as toolCallsRouter };
