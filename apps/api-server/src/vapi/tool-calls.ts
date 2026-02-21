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

type UnknownRecord = Record<string, unknown>;

// Keep a short-lived in-memory session map to avoid repeated Convex lookups
// for every webhook event in the same call.
const SESSION_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_SESSION_CACHE_SIZE = 2000;
const sessionConversationCache = new Map<
  string,
  { conversationId: string; expiresAt: number }
>();

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
    call: z.record(z.unknown()).optional().nullable(),
    metadata: z.record(z.unknown()).optional().nullable(),
  }).passthrough(),
});

type ActionStatus = "executed" | "escalated" | "blocked" | "failed";

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
  callRecord?: UnknownRecord;
};

function asRecord(value: unknown): UnknownRecord | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as UnknownRecord;
  }
  return undefined;
}

function getMessageRecord(payload: UnknownRecord): UnknownRecord {
  return asRecord(payload.message) ?? payload;
}

function getMessageType(message: UnknownRecord): string | undefined {
  const type = message.type;
  return typeof type === "string" && type.length > 0 ? type : undefined;
}

function getMetadata(
  message: UnknownRecord,
  payload: UnknownRecord
): UnknownRecord {
  return asRecord(message.metadata) ?? asRecord(payload.metadata) ?? {};
}

function getCallRecord(
  message: UnknownRecord,
  payload: UnknownRecord
): UnknownRecord | undefined {
  return asRecord(message.call) ?? asRecord(payload.call);
}

function parseCallId(
  callRecord: UnknownRecord | undefined,
  metadata: UnknownRecord
): string | undefined {
  const callId = callRecord?.id;
  if (typeof callId === "string" && callId.length > 0) {
    return callId;
  }
  const metadataCallId = metadata.callId;
  if (typeof metadataCallId === "string" && metadataCallId.length > 0) {
    return metadataCallId;
  }
  return undefined;
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

function extractSummary(message: UnknownRecord): string | undefined {
  const directSummary = message.summary;
  if (typeof directSummary === "string" && directSummary.trim().length > 0) {
    return directSummary.trim();
  }

  const analysisRecord = asRecord(message.analysis);
  if (!analysisRecord) return undefined;

  const analysisSummary = analysisRecord.summary;
  if (
    typeof analysisSummary === "string" &&
    analysisSummary.trim().length > 0
  ) {
    return analysisSummary.trim();
  }

  const nestedSummary = asRecord(analysisSummary);
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

function channelTypeForCall(
  callRecord: UnknownRecord | undefined
): "vapi_web" | "plivo_phone" {
  const callType = callRecord?.type;
  if (typeof callType === "string" && /phone/i.test(callType)) {
    return "plivo_phone";
  }
  return "vapi_web";
}

function extractTranscriptText(message: UnknownRecord): string {
  if (typeof message.transcript === "string") {
    return message.transcript.trim();
  }

  const transcriptObj = asRecord(message.transcript);
  if (transcriptObj && typeof transcriptObj.text === "string") {
    return transcriptObj.text.trim();
  }

  if (typeof message.text === "string") {
    return message.text.trim();
  }

  return "";
}

function isFinalTranscript(messageType: string, message: UnknownRecord): boolean {
  if (messageType === "transcript[transcriptType='final']") {
    return true;
  }
  const transcriptType = message.transcriptType;
  if (typeof transcriptType === "string" && transcriptType.toLowerCase() === "final") {
    return true;
  }
  if (message.isFinal === true || message.final === true) {
    return true;
  }
  return false;
}

function getCachedConversationId(callId: string): string | undefined {
  const cached = sessionConversationCache.get(callId);
  if (!cached) return undefined;
  if (cached.expiresAt < Date.now()) {
    sessionConversationCache.delete(callId);
    return undefined;
  }
  return cached.conversationId;
}

function setCachedConversationId(callId: string, conversationId: string): void {
  const now = Date.now();
  for (const [key, value] of sessionConversationCache) {
    if (value.expiresAt < now) {
      sessionConversationCache.delete(key);
    }
  }
  while (sessionConversationCache.size >= MAX_SESSION_CACHE_SIZE) {
    const oldestKey = sessionConversationCache.keys().next().value;
    if (!oldestKey) break;
    sessionConversationCache.delete(oldestKey);
  }

  sessionConversationCache.set(callId, {
    conversationId,
    expiresAt: now + SESSION_CACHE_TTL_MS,
  });
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

async function resolveSessionContext(
  message: UnknownRecord,
  payload: UnknownRecord,
  opts: {
    ensureConversation?: boolean;
    loadConversationDetails?: boolean;
  } = {}
): Promise<SessionContext> {
  const metadata = getMetadata(message, payload);
  const callRecord = getCallRecord(message, payload);

  const callId = parseCallId(callRecord, metadata);
  let conversationId =
    typeof metadata.conversationId === "string"
      ? metadata.conversationId
      : undefined;

  let conversation: ConversationRecord | null | undefined;

  let trustLevel = parseTrustLevel(metadata.trustLevel) ?? 2;
  let sentiment = parseSentiment(metadata.sentiment) ?? "neutral";
  let customerId =
    typeof metadata.customerId === "string" ? metadata.customerId : undefined;

  if (conversationId) {
    try {
      conversation = (await convex.query(api.conversations.getById, {
        id: conversationId,
      })) as ConversationRecord | null;
      if (!conversation?._id) {
        conversationId = undefined;
      }
    } catch (err) {
      log.warn(
        { err, conversationId },
        "Ignoring invalid metadata conversationId"
      );
      conversationId = undefined;
    }
  }

  if (!conversationId && callId) {
    const cachedConversationId = getCachedConversationId(callId);
    if (cachedConversationId) {
      conversationId = cachedConversationId;
    }
  }

  if (!conversationId && callId) {
    try {
      conversation = (await convex.query(api.conversations.getBySessionId, {
        channelSessionId: callId,
      })) as ConversationRecord | null;
      if (conversation?._id) {
        conversationId = conversation._id;
        setCachedConversationId(callId, conversationId);
      }
    } catch (err) {
      log.warn({ err, callId }, "Failed to resolve conversation by call ID");
    }
  }

  if (!conversationId && opts.ensureConversation && callId) {
    try {
      conversationId = (await convex.mutation(api.conversations.upsertBySession, {
        channelType: channelTypeForCall(callRecord),
        channelSessionId: callId,
        trustLevel,
        sentimentScore: sentiment,
        startedAt: parseTimestamp(callRecord?.startedAt),
      })) as string;
      setCachedConversationId(callId, conversationId);
    } catch (err) {
      log.warn(
        { err, callId },
        "Failed to create or load conversation for call session"
      );
    }
  }

  if (conversationId && opts.loadConversationDetails && !conversation) {
    try {
      conversation = (await convex.query(api.conversations.getById, {
        id: conversationId,
      })) as ConversationRecord | null;
    } catch (err) {
      log.warn({ err, conversationId }, "Failed to load conversation context");
    }
  }

  if (conversation) {
    if (!customerId && conversation.customerId) {
      customerId = conversation.customerId;
    }
    if (typeof conversation.trustLevel === "number") {
      const parsed = parseTrustLevel(conversation.trustLevel);
      if (parsed) trustLevel = parsed;
    }
    if (typeof conversation.sentimentScore === "string") {
      const parsed = parseSentiment(conversation.sentimentScore);
      if (parsed) sentiment = parsed;
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
    statusHint?: "completed" | "failed";
    endedReason?: string;
    endedAt?: number;
    summary?: string;
  }
): Promise<void> {
  const status =
    opts.statusHint ??
    (isFailedEndedReason(opts.endedReason) ? "failed" : "completed");
  const endedAt = opts.endedAt ?? Date.now();

  if (session.callId) {
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

      setCachedConversationId(session.callId, conversationId);
      return;
    } catch (err) {
      log.warn({ err, callId: session.callId }, "Failed to finalize call by session");
    }
  }

  if (session.conversationId) {
    try {
      await convex.mutation(api.conversations.update, {
        id: session.conversationId,
        status,
        endedAt,
        summary: opts.summary,
        sentimentScore: session.sentiment,
      });
    } catch (err) {
      log.warn(
        { err, conversationId: session.conversationId },
        "Failed to finalize call by conversation id"
      );
    }
  }
}

router.post("/tool-calls", async (req, res) => {
  let parsedMessageType: string | undefined;

  try {
    const payload = asRecord(req.body);
    if (!payload) {
      log.warn("Ignoring non-object VAPI payload");
      res.status(200).json({ ok: true });
      return;
    }

    const message = getMessageRecord(payload);
    const messageType = getMessageType(message);
    parsedMessageType = messageType;

    if (!messageType) {
      log.warn("Ignoring VAPI payload without message type");
      res.status(200).json({ ok: true });
      return;
    }

    if (messageType === "assistant.started" || messageType === "conversation-update") {
      await resolveSessionContext(message, payload, {
        ensureConversation: true,
      });
      res.status(200).json({ ok: true });
      return;
    }

    if (
      messageType === "transcript" ||
      messageType === "transcript[transcriptType='final']"
    ) {
      if (!isFinalTranscript(messageType, message)) {
        res.status(200).json({ ok: true });
        return;
      }

      const transcript = extractTranscriptText(message);
      if (!transcript) {
        res.status(200).json({ ok: true });
        return;
      }

      const session = await resolveSessionContext(message, payload, {
        ensureConversation: true,
      });

      if (session.conversationId) {
        const role = message.role;
        const speaker =
          role === "assistant" || role === "agent" ? "agent" : "customer";

        try {
          await convex.mutation(api.transcripts.add, {
            conversationId: session.conversationId,
            speaker,
            isFinal: true,
            text: transcript,
          });
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
      const status =
        typeof message.status === "string" ? message.status.toLowerCase() : "";

      if (status === "ended" || status === "completed" || status === "failed") {
        const session = await resolveSessionContext(message, payload, {
          ensureConversation: true,
        });

        const endedReason =
          typeof message.endedReason === "string" ? message.endedReason : undefined;

        const endedAt =
          parseTimestamp(message.endedAt) ??
          parseTimestamp(session.callRecord?.endedAt) ??
          Date.now();

        await finalizeConversation(session, {
          statusHint: status === "failed" ? "failed" : "completed",
          endedReason,
          endedAt,
        });
      }

      res.status(200).json({ ok: true });
      return;
    }

    if (
      messageType === "end-of-call-report" ||
      messageType === "call-end" ||
      messageType === "call.ended"
    ) {
      const session = await resolveSessionContext(message, payload, {
        ensureConversation: true,
      });

      const endedReason =
        typeof message.endedReason === "string" ? message.endedReason : undefined;
      const summary = extractSummary(message);
      const eventStatus =
        typeof message.status === "string" ? message.status.toLowerCase() : "";
      const endedAt =
        parseTimestamp(message.endedAt) ??
        parseTimestamp(session.callRecord?.endedAt) ??
        Date.now();

      await finalizeConversation(session, {
        statusHint: eventStatus === "failed" ? "failed" : undefined,
        endedReason,
        endedAt,
        summary,
      });

      res.status(200).json({ ok: true });
      return;
    }

    if (messageType === "hang") {
      // Hang can arrive before the final report; treat as informational only.
      res.status(200).json({ ok: true });
      return;
    }

    if (messageType !== "tool-calls") {
      log.debug({ type: messageType }, "Ignoring non-tool-call VAPI event");
      res.status(200).json({ ok: true });
      return;
    }

    const parseResult = VapiToolCallWebhookSchema.safeParse({ message });
    if (!parseResult.success) {
      log.warn({ errors: parseResult.error.issues }, "Invalid tool-calls payload");
      res.status(200).json({ results: [] });
      return;
    }

    const session = await resolveSessionContext(message, payload, {
      ensureConversation: true,
      loadConversationDetails: true,
    });

    const sessionMeta = getMetadata(message, payload);
    const callId = session.callId ?? "unknown-call";
    const trustLevel = session.trustLevel;
    const sentiment = session.sentiment;
    const conversationId = session.conversationId;
    const customerId = session.customerId;

    const { toolCallList } = parseResult.data.message;

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

          return {
            toolCallId: toolCall.id,
            result: JSON.stringify({
              error:
                "I encountered an issue processing that request. Let me create a ticket for you instead.",
            }),
          };
        }
      })
    );

    res.status(200).json({ results });
  } catch (err) {
    log.error({ err, parsedMessageType }, "Unhandled VAPI webhook error");

    if (parsedMessageType === "tool-calls") {
      res.status(200).json({ results: [] });
      return;
    }

    res.status(200).json({ ok: true });
  }
});

export { router as toolCallsRouter };
