import { Router } from "express";
import { z } from "zod";
import pino from "pino";
import { executeWithGovernance } from "../policy/executor.js";
import { toMcpToolName } from "./tool-definitions.js";
import type { Sentiment, TrustLevel } from "@shielddesk/shared";
import { convex } from "../convex-client.js";
import { anyApi } from "convex/server";

const log = pino({ name: "vapi-tool-calls" });
const api = anyApi;

const router = Router();

const ToolCallItemSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    arguments: z.union([z.record(z.unknown()), z.string()]),
  }),
});

const BaseWebhookSchema = z.object({
  message: z.object({
    type: z.string(),
    call: z.record(z.unknown()).nullable().optional(),
    metadata: z.record(z.unknown()).nullable().optional(),
  }).passthrough(),
});

const VapiToolCallWebhookSchema = z.object({
  message: z.object({
    type: z.literal("tool-calls"),
    toolCallList: z.array(ToolCallItemSchema),
    call: z.record(z.unknown()).nullable().optional(),
    metadata: z.record(z.unknown()).nullable().optional(),
  }).passthrough(),
});

type ActionStatus =
  | "executed"
  | "escalated"
  | "blocked"
  | "failed";

type ConversationRecord = {
  _id: string;
  customerId?: string;
  trustLevel?: number;
  sentimentScore?: string;
};

type SessionContext = {
  callId?: string;
  conversationId?: string;
  customerId?: string;
  trustLevel: TrustLevel;
  sentiment: Sentiment;
  callRecord?: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return undefined;
}

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

function parseCallId(callRecord: Record<string, unknown> | undefined): string | undefined {
  if (!callRecord) return undefined;
  const id = callRecord.id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function parseTrustLevel(value: unknown): TrustLevel | undefined {
  if (value === 1 || value === 2 || value === 3 || value === 4) {
    return value;
  }
  return undefined;
}

function parseSentiment(value: unknown): Sentiment | undefined {
  if (
    value === "frustrated" ||
    value === "neutral" ||
    value === "satisfied" ||
    value === "calm"
  ) {
    return value;
  }
  return undefined;
}

function isFailedEndedReason(endedReason: string | undefined): boolean {
  if (!endedReason) return false;
  return /(error|failed|fault|unauthorized|denied|timed-out|not-found)/i.test(
    endedReason
  );
}

function extractSummary(message: Record<string, unknown>): string | undefined {
  const directSummary = message.summary;
  if (typeof directSummary === "string" && directSummary.trim().length > 0) {
    return directSummary.trim();
  }

  const analysisRecord = asRecord(message.analysis);
  if (!analysisRecord) return undefined;

  if (
    typeof analysisRecord.summary === "string" &&
    analysisRecord.summary.trim().length > 0
  ) {
    return analysisRecord.summary.trim();
  }

  const nestedSummary = asRecord(analysisRecord.summary);
  if (!nestedSummary) return undefined;

  if (
    typeof nestedSummary.summary === "string" &&
    nestedSummary.summary.trim().length > 0
  ) {
    return nestedSummary.summary.trim();
  }

  if (
    typeof nestedSummary.text === "string" &&
    nestedSummary.text.trim().length > 0
  ) {
    return nestedSummary.text.trim();
  }

  return undefined;
}

function channelTypeForCall(callRecord: Record<string, unknown> | undefined): "vapi_web" | "plivo_phone" {
  const callType = callRecord?.type;
  if (typeof callType === "string" && /phone/i.test(callType)) {
    return "plivo_phone";
  }
  return "vapi_web";
}

async function logToolDecisionEvent(
  conversationId: string | undefined,
  decision: "allow" | "deny" | "escalate",
  payload: Record<string, unknown>
): Promise<void> {
  if (!conversationId) return;

  const kind =
    decision === "allow"
      ? "tool_called"
      : decision === "deny"
        ? "tool_blocked"
        : "tool_escalated";

  try {
    await convex.mutation(api.conversationEvents.add, {
      conversationId,
      kind,
      actorKind: "system",
      payload,
    });
  } catch (err) {
    log.warn(
      { err, conversationId, kind },
      "Failed to persist tool decision timeline event"
    );
  }
}

async function logMessageEvent(
  conversationId: string | undefined,
  actorKind: "customer" | "agent" | "system",
  payload: Record<string, unknown>
): Promise<void> {
  if (!conversationId) return;

  try {
    await convex.mutation(api.conversationEvents.add, {
      conversationId,
      kind: "message",
      actorKind,
      payload,
    });
  } catch (err) {
    log.warn(
      { err, conversationId },
      "Failed to persist conversation message event"
    );
  }
}

async function logSummaryEvent(
  conversationId: string | undefined,
  summary: string
): Promise<void> {
  if (!conversationId) return;

  try {
    await convex.mutation(api.conversationEvents.add, {
      conversationId,
      kind: "summary_generated",
      actorKind: "system",
      payload: { summary },
    });
  } catch (err) {
    log.warn(
      { err, conversationId },
      "Failed to persist summary event"
    );
  }
}

async function resolveSessionContext(
  message: Record<string, unknown>
): Promise<SessionContext> {
  const metadata = asRecord(message.metadata) ?? {};
  const callRecord = asRecord(message.call);
  const callId = parseCallId(callRecord);

  let trustLevel: TrustLevel = parseTrustLevel(metadata.trustLevel) ?? 2;
  let sentiment: Sentiment = parseSentiment(metadata.sentiment) ?? "neutral";

  let conversationId: string | undefined;
  let customerId: string | undefined;

  const metadataConversationId =
    typeof metadata.conversationId === "string" ? metadata.conversationId : undefined;

  if (metadataConversationId) {
    try {
      const conv = (await convex.query(api.conversations.getById, {
        id: metadataConversationId,
      })) as ConversationRecord | null;
      if (conv?._id) {
        conversationId = conv._id;
      }
    } catch (err) {
      log.warn(
        { err, metadataConversationId },
        "Ignoring invalid metadata conversationId"
      );
    }
  }

  if (!conversationId && callId) {
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

  if (!conversationId && callId) {
    try {
      conversationId = (await convex.mutation(api.conversations.upsertBySession, {
        channelType: channelTypeForCall(callRecord),
        channelSessionId: callId,
        trustLevel,
        sentimentScore: sentiment,
        startedAt: parseTimestamp(callRecord?.startedAt),
      })) as string;
    } catch (err) {
      log.warn({ err, callId }, "Failed to upsert conversation for call session");
    }
  }

  if (conversationId) {
    try {
      const conv = (await convex.query(api.conversations.getById, {
        id: conversationId,
      })) as ConversationRecord | null;
      if (conv) {
        customerId = conv.customerId;
        if (typeof conv.trustLevel === "number") {
          const parsedTrust = parseTrustLevel(conv.trustLevel);
          if (parsedTrust) {
            trustLevel = parsedTrust;
          }
        }
        if (typeof conv.sentimentScore === "string") {
          const parsedSentiment = parseSentiment(conv.sentimentScore);
          if (parsedSentiment) {
            sentiment = parsedSentiment;
          }
        }
      }
    } catch (err) {
      log.warn(
        { err, conversationId },
        "Failed to load resolved conversation context"
      );
    }
  }

  return {
    callId,
    conversationId,
    customerId,
    trustLevel,
    sentiment,
    callRecord,
  };
}

async function finalizeConversation(
  session: SessionContext,
  opts: {
    endedReason?: string;
    endedAt?: number;
    summary?: string;
  }
): Promise<void> {
  if (!session.callId) {
    return;
  }

  const status = isFailedEndedReason(opts.endedReason) ? "failed" : "completed";
  const endedAt = opts.endedAt ?? Date.now();

  try {
    const conversationId = (await convex.mutation(api.conversations.finalizeBySession, {
      channelType: channelTypeForCall(session.callRecord),
      channelSessionId: session.callId,
      status,
      trustLevel: session.trustLevel,
      sentimentScore: session.sentiment,
      endedAt,
      summary: opts.summary,
    })) as string;

    await logMessageEvent(conversationId, "system", {
      source: "vapi",
      type: "call-ended",
      endedReason: opts.endedReason,
      status,
    });

    if (typeof opts.summary === "string" && opts.summary.trim().length > 0) {
      await logSummaryEvent(conversationId, opts.summary);
    }
  } catch (err) {
    log.warn(
      { err, callId: session.callId },
      "Failed to finalize conversation"
    );
  }
}

router.post("/tool-calls", async (req, res) => {
  const baseParse = BaseWebhookSchema.safeParse(req.body);
  if (!baseParse.success) {
    log.warn({ errors: baseParse.error.issues }, "Invalid VAPI payload");
    res.status(400).json({
      error: { message: "Invalid payload", details: baseParse.error.issues },
    });
    return;
  }

  const baseMessage = baseParse.data.message as Record<string, unknown>;
  const messageType =
    typeof baseMessage.type === "string" ? baseMessage.type : "unknown";

  const session = await resolveSessionContext(baseMessage);

  if (messageType === "tool-calls") {
    const parseResult = VapiToolCallWebhookSchema.safeParse(req.body);
    if (!parseResult.success) {
      log.warn({ errors: parseResult.error.issues }, "Invalid tool-calls payload");
      res.status(400).json({
        error: { message: "Invalid payload", details: parseResult.error.issues },
      });
      return;
    }

    const { message } = parseResult.data;
    const { toolCallList, metadata } = message;
    const sessionMeta = metadata ?? {};
    const callId = session.callId ?? "unknown-call";
    const trustLevel = session.trustLevel;
    const sentiment = session.sentiment;
    const conversationId = session.conversationId;
    const customerId = session.customerId;

    log.info(
      {
        toolCount: toolCallList.length,
        tools: toolCallList.map((tc) => tc.function.name),
        callId,
      },
      "Tool-calls webhook from VAPI"
    );

    const results = await Promise.all(
      toolCallList.map(async (toolCall) => {
        const toolName = toMcpToolName(toolCall.function.name);
        const idempotencyKey = `${callId}:${toolCall.id}:${toolName}`;

        let toolArgs: Record<string, unknown>;
        if (typeof toolCall.function.arguments === "string") {
          try {
            toolArgs = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
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

        const confidence =
          typeof sessionMeta.confidence === "number" ? sessionMeta.confidence : 0.9;

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
                  existing.policyReason ?? "This request was already processed.",
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
            const resultContent =
              govResult.toolResult &&
              typeof govResult.toolResult === "object" &&
              "content" in (govResult.toolResult as Record<string, unknown>)
                ? (
                    (govResult.toolResult as { content: Array<{ text: string }> })
                      .content[0]?.text ?? "{}"
                  )
                : JSON.stringify(govResult.toolResult ?? {});

            try {
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
            } catch (logErr) {
              log.error(
                { err: logErr, toolName, idempotencyKey },
                "Failed to persist action log"
              );
            }

            await logToolDecisionEvent(conversationId, govResult.decision, {
              toolName,
              policyReason: govResult.reason,
              riskScore: govResult.riskScore,
              effectiveThreshold: govResult.effectiveThreshold,
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

            try {
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
            } catch (logErr) {
              log.error(
                { err: logErr, toolName, idempotencyKey },
                "Failed to persist action log"
              );
            }

            await logToolDecisionEvent(conversationId, govResult.decision, {
              toolName,
              policyReason: govResult.reason,
              riskScore: govResult.riskScore,
              effectiveThreshold: govResult.effectiveThreshold,
            });

            return {
              toolCallId: toolCall.id,
              result: escalatedResult,
            };
          }

          const deniedResult = JSON.stringify({
            denied: true,
            message: `This action cannot be performed automatically. ${govResult.reason}.`,
          });

          try {
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
          } catch (logErr) {
            log.error(
              { err: logErr, toolName, idempotencyKey },
              "Failed to persist action log"
            );
          }

          await logToolDecisionEvent(conversationId, govResult.decision, {
            toolName,
            policyReason: govResult.reason,
            riskScore: govResult.riskScore,
            effectiveThreshold: govResult.effectiveThreshold,
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
            error:
              "I encountered an issue processing that request. Let me create a ticket for you instead.",
          });

          return {
            toolCallId: toolCall.id,
            result: failedResult,
          };
        }
      })
    );

    res.json({ results });
    return;
  }

  if (messageType === "transcript" || messageType === "transcript[transcriptType='final']") {
    const transcript = typeof baseMessage.transcript === "string"
      ? baseMessage.transcript.trim()
      : "";
    const transcriptType = baseMessage.transcriptType;
    const isFinal =
      messageType === "transcript[transcriptType='final']" ||
      transcriptType === "final";

    if (session.conversationId && transcript.length > 0 && isFinal) {
      const role = baseMessage.role === "assistant" ? "agent" : "customer";

      try {
        await convex.mutation(api.transcripts.add, {
          conversationId: session.conversationId,
          speaker: role,
          isFinal: true,
          text: transcript,
        });

        await logMessageEvent(
          session.conversationId,
          role === "agent" ? "agent" : "customer",
          {
            source: "vapi",
            text: transcript,
          }
        );
      } catch (err) {
        log.warn(
          { err, conversationId: session.conversationId },
          "Failed to persist transcript"
        );
      }
    }

    res.status(200).json({ ok: true });
    return;
  }

  if (messageType === "status-update") {
    const status = baseMessage.status;
    if (status === "ended") {
      const endedReason =
        typeof baseMessage.endedReason === "string"
          ? baseMessage.endedReason
          : undefined;

      const endedAt =
        parseTimestamp(baseMessage.endedAt) ??
        parseTimestamp(session.callRecord?.endedAt) ??
        Date.now();

      await finalizeConversation(session, {
        endedReason,
        endedAt,
      });
    }

    res.status(200).json({ ok: true });
    return;
  }

  if (messageType === "end-of-call-report") {
    const endedReason =
      typeof baseMessage.endedReason === "string"
        ? baseMessage.endedReason
        : undefined;

    const summary = extractSummary(baseMessage);
    const endedAt =
      parseTimestamp(baseMessage.endedAt) ??
      parseTimestamp(session.callRecord?.endedAt) ??
      Date.now();

    await finalizeConversation(session, {
      endedReason,
      endedAt,
      summary,
    });

    res.status(200).json({ ok: true });
    return;
  }

  if (messageType === "assistant.started" || messageType === "conversation-update") {
    // Handled via resolveSessionContext upsert.
    res.status(200).json({ ok: true });
    return;
  }

  if (messageType === "hang") {
    await logMessageEvent(session.conversationId, "system", {
      source: "vapi",
      type: "hang",
      note: "Assistant hang event received; waiting for definitive end-of-call signal.",
    });
    res.status(200).json({ ok: true });
    return;
  }

  log.debug({ type: messageType }, "Ignoring non-tool-call VAPI event");
  res.status(200).json({ ok: true });
});

export { router as toolCallsRouter };
