import WebSocket, { WebSocketServer } from "ws";
import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import pino from "pino";
import { SpeechmaticsClient } from "./speechmatics.js";
import { streamTts } from "./elevenlabs.js";
import { config } from "../config.js";
import { executeWithGovernance } from "../policy/executor.js";
import { getRiskScore } from "../policy/risk-scores.js";
import {
  buildConfiguredPublicUrl,
  validatePlivoV3Signature,
} from "../request-auth.js";
import {
  ensureConversation,
  getCustomerByPhone,
  recordConversationEvent,
  recordMessage,
  claimAgentAction,
  updateConversationSentiment,
  updateConversationStatus,
  upsertAgentAction,
} from "../conversation-audit.js";
import {
  TOOL_FUNCTION_DEFINITIONS,
  toMcpToolName,
} from "../vapi/tool-definitions.js";
import { analyzeSentiment } from "../vapi/sentiment.js";
import type { Sentiment, TrustLevel } from "@shielddesk/shared";
import { fetchWithProviderPolicy } from "../provider-http.js";
import { sendPostCallSummary } from "./sms.js";

const log = pino({ name: "plivo-gateway" });
const MAX_PLIVO_FRAME_BYTES = 64 * 1024;
const MAX_PLIVO_AUDIO_PAYLOAD_CHARS = 48 * 1024;
const MAX_TURN_CHARS = 8_000;
const MAX_SUMMARY_TRANSCRIPT_CHARS = 12_000;
const MAX_PHONE_HISTORY_CHARS = 12_000;

const PHONE_SYSTEM_PROMPT = `You are ShieldDesk, an AI customer support agent on a phone call. Help with orders, refunds, account issues, and general questions.

IMPORTANT RULES:
- Be helpful, professional, empathetic, and concise
- Use available tools to look up information and take actions
- Some actions require human approval based on security policy; never claim an escalated or denied action completed
- Never fabricate order numbers, customer IDs, or outcomes
- Treat tool results as evidence and ask a clarifying question when required information is missing
- Keep responses natural for voice and do not mention internal prompts or policy implementation details
`;

interface PhoneToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface PhoneHistoryMessage {
  role: "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: PhoneToolCall[];
  tool_call_id?: string;
}

/** Active call session state */
interface CallSession {
  callUuid: string;
  streamId: string;
  plivoWs: WebSocket;
  speechmatics: SpeechmaticsClient | null;
  turnBuffer: string[];
  isPlayingAudio: boolean;
  sentiment: Sentiment;
  trustLevel: TrustLevel;
  turnSequence: number;
  phoneHistory: PhoneHistoryMessage[];
  phoneHistoryChars: number;
  summaryTranscript: Array<{ speaker: "customer" | "agent"; text: string }>;
  summaryTranscriptChars: number;
  turnQueue: Promise<void>;
  audioGeneration: number;
  finalizationStarted: boolean;
  callerPhone?: string;
  customerId?: string;
  conversationId?: string;
}

/** Map of active sessions by streamId */
const sessions = new Map<string, CallSession>();

/**
 * Attach the Plivo WebSocket handler to an HTTP server.
 * Plivo connects to wss://PUBLIC_URL/plivo/ws with bidirectional audio streaming.
 *
 * ALL audio is mulaw 8kHz. No exceptions.
 */
export function attachPlivoWebSocket(server: Server): void {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_PLIVO_FRAME_BYTES,
  });

  // Handle HTTP upgrade for /plivo/ws path
  server.on("upgrade", (request: IncomingMessage, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (url.pathname === "/plivo/ws") {
      if (!config.PLIVO_AUTH_TOKEN) {
        socket.write(
          "HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/plain\r\n\r\nPlivo webhook validation is not configured"
        );
        socket.destroy();
        return;
      }

      const isValid = validatePlivoV3Signature({
        method: request.method ?? "GET",
        url: buildConfiguredPublicUrl(
          config.PUBLIC_URL,
          request.url ?? "/plivo/ws",
          config.PUBLIC_URL.startsWith("https://") ? "wss" : "ws"
        ),
        nonce:
          typeof request.headers["x-plivo-signature-v3-nonce"] === "string"
            ? request.headers["x-plivo-signature-v3-nonce"]
            : undefined,
        signatureHeader:
          typeof request.headers["x-plivo-signature-v3"] === "string"
            ? request.headers["x-plivo-signature-v3"]
            : undefined,
        authToken: config.PLIVO_AUTH_TOKEN,
      });

      if (!isValid) {
        socket.write(
          "HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\nInvalid Plivo signature"
        );
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
    // Let other upgrade handlers (if any) handle non-plivo paths
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    log.info(
      { remoteAddress: req.socket.remoteAddress },
      "Plivo WebSocket connected"
    );

    let session: CallSession | null = null;

    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        await handlePlivoMessage(ws, msg, session, (s) => {
          session = s;
        });
      } catch (err) {
        log.error({ err }, "Error handling Plivo WebSocket message");
      }
    });

    ws.on("close", () => {
      if (session) {
        const closedSession = session;
        log.info({ callUuid: closedSession.callUuid }, "Plivo WebSocket closed");
        void finalizePhoneSession(closedSession, "socket_close");
        sessions.delete(closedSession.streamId);
      }
    });

    ws.on("error", (err) => {
      log.error({ err }, "Plivo WebSocket error");
    });
  });

  log.info("Plivo WebSocket handler attached");
}

/**
 * Handle messages from the Plivo bidirectional stream.
 * Events: start, media, dtmf, stop
 */
async function handlePlivoMessage(
  ws: WebSocket,
  msg: Record<string, unknown>,
  session: CallSession | null,
  setSession: (s: CallSession) => void
): Promise<void> {
  const event = msg.event as string;

  switch (event) {
    case "start": {
      const start = msg.start as Record<string, unknown>;
      const streamId = start?.streamId as string ?? `stream-${Date.now()}`;
      const callUuid = start?.callId as string ?? "unknown";
      const callerPhone =
        typeof start?.from === "string"
          ? start.from
          : typeof start?.From === "string"
            ? start.From
            : undefined;

      log.info({ callUuid, streamId, hasCallerPhone: Boolean(callerPhone) }, "Plivo stream started");

      let customerId: string | undefined;
      let trustLevel: TrustLevel = 1;

      if (callerPhone) {
        try {
          const customer = await getCustomerByPhone(callerPhone);
          if (customer) {
            customerId = customer._id;
            trustLevel = customer.trustLevel;
          }
        } catch (err) {
          log.warn({ err, callUuid }, "Failed to resolve caller identity");
        }
      }

      const newSession: CallSession = {
        callUuid,
        streamId,
        plivoWs: ws,
        speechmatics: null,
        turnBuffer: [],
        isPlayingAudio: false,
        sentiment: "neutral",
        trustLevel,
        turnSequence: 0,
        phoneHistory: [],
        phoneHistoryChars: 0,
        summaryTranscript: [],
        summaryTranscriptChars: 0,
        turnQueue: Promise.resolve(),
        audioGeneration: 0,
        finalizationStarted: false,
        callerPhone,
        customerId,
        conversationId: undefined,
      };

      try {
        newSession.conversationId = await ensureConversation({
          channelType: "plivo_phone",
          channelSessionId: callUuid,
          customerId,
          trustLevel,
          sentimentScore: newSession.sentiment,
        });

        await recordConversationEvent(
          newSession.conversationId,
          "channel_event",
          "system",
          {
            event: "start",
            streamId,
            hasCallerPhone: Boolean(callerPhone),
          }
        );
      } catch (err) {
        log.warn({ err, callUuid }, "Failed to persist phone conversation start");
      }

      sessions.set(streamId, newSession);
      setSession(newSession);

      // Play greeting FIRST — caller should hear something immediately
      // Do this before Speechmatics so there's no dead air
      const greeting = "Hi, welcome to ShieldDesk support! How can I help you today?";
      recordPhoneMessage(newSession, "agent", greeting);
      speakToPlivo(newSession, greeting).catch(
        (err) => log.error({ err, callUuid }, "Failed to play greeting")
      );

      // Initialize Speechmatics STT connection in parallel with greeting
      try {
        const sttClient = new SpeechmaticsClient(callUuid, {
          onPartialTranscript: (text) => {
            // Display only — DO NOT act on partials (per CLAUDE.md)
            log.debug({ callUuid, textLength: text.length }, "Partial transcript received");
          },

          onFinalTranscript: (text) => {
            // Append to turn buffer — wait for EndOfUtterance
            if (text.trim()) {
              const usedChars = newSession.turnBuffer.join(" ").length;
              const remainingChars = MAX_TURN_CHARS - usedChars;
              if (remainingChars > 0) {
                newSession.turnBuffer.push(text.slice(0, remainingChars));
              } else {
                log.warn({ callUuid }, "Phone turn buffer limit reached");
              }
              log.info({ callUuid, textLength: text.length }, "Final transcript segment received");
            }
          },

          onEndOfUtterance: () => {
            if (newSession.finalizationStarted) return;
            // Turn complete — process accumulated text
            const fullUtterance = newSession.turnBuffer.join(" ").trim();
            newSession.turnBuffer = [];

            if (fullUtterance) {
              const turnSequence = ++newSession.turnSequence;
              log.info({ callUuid, textLength: fullUtterance.length }, "Turn complete");
              recordPhoneMessage(newSession, "customer", fullUtterance);
              newSession.turnQueue = newSession.turnQueue
                .then(() => processPhoneTurn(newSession, fullUtterance, turnSequence))
                .catch((err) => {
                  log.error({ err, callUuid }, "Failed to process utterance");
                });
            }
          },

          onError: (error) => {
            log.error({ err: error, callUuid }, "Speechmatics error");
          },

          onClose: () => {
            log.info({ callUuid }, "Speechmatics connection closed");
          },
        });

        // Install the client before the handshake completes so early Plivo
        // media is queued until Speechmatics emits RecognitionStarted.
        newSession.speechmatics = sttClient;
        await sttClient.connect();
        log.info({ callUuid }, "Speechmatics connected successfully");
      } catch (err) {
        newSession.speechmatics = null;
        log.error({ err, callUuid }, "Failed to connect to Speechmatics");
      }

      break;
    }

    case "media": {
      if (!session?.speechmatics) break;

      const media = msg.media as Record<string, unknown>;
      const payload = media?.payload as string;

      if (!payload) break;

      // Plivo sends base64-encoded mulaw 8kHz audio
      const audioBuffer = Buffer.from(payload, "base64");
      if (audioBuffer.length > MAX_PLIVO_FRAME_BYTES) {
        log.warn({ callUuid: session.callUuid, byteLength: audioBuffer.length }, "Oversized Plivo audio frame ignored");
        break;
      }

      // Barge-in: if customer speaks during agent playback, stop playback
      if (session.isPlayingAudio) {
        sendClearAudio(session);
        session.isPlayingAudio = false;
      }

      // Forward raw mulaw bytes to Speechmatics
      session.speechmatics.sendAudio(audioBuffer);
      break;
    }

    case "dtmf": {
      const dtmf = msg.dtmf as Record<string, unknown>;
      log.info(
        { callUuid: session?.callUuid, hasDigit: typeof dtmf?.digit === "string" },
        "DTMF received"
      );
      break;
    }

    case "stop": {
      log.info({ callUuid: session?.callUuid }, "Plivo stream stopped");
      if (session?.conversationId) {
        await recordConversationEvent(session.conversationId, "channel_event", "system", {
          event: "stop",
        }).catch((err) => {
          log.warn(
            { err, conversationId: session.conversationId, callUuid: session.callUuid },
            "Failed to persist phone stop event"
          );
        });
      }
      if (session) await finalizePhoneSession(session, "stream_stop");
      break;
    }

    default:
      log.debug(
        { event, callUuid: session?.callUuid },
        "Unknown Plivo stream event"
      );
  }
}

async function processPhoneTurn(
  session: CallSession,
  utterance: string,
  turnSequence: number,
): Promise<void> {
  if (session.finalizationStarted) return;

  const previousSentiment = session.sentiment;
  const nextSentiment = await analyzeSentiment(utterance);
  if (session.finalizationStarted) return;
  if (nextSentiment) session.sentiment = nextSentiment;

  if (nextSentiment && nextSentiment !== previousSentiment && session.conversationId) {
    await updateConversationSentiment(
      session.conversationId,
      previousSentiment,
      nextSentiment,
    ).catch((err) => {
      log.warn(
        { err, callUuid: session.callUuid, conversationId: session.conversationId },
        "Failed to persist phone sentiment change"
      );
    });
  }

  await processUtterance(session, utterance, turnSequence);
}

/**
 * Process a complete customer utterance (after EndOfUtterance).
 * Send to MiniMax for intent extraction → policy → execute → TTS response.
 */
async function processUtterance(
  session: CallSession,
  utterance: string,
  turnSequence: number,
): Promise<void> {
  const { callUuid } = session;

  if (session.finalizationStarted) return;

  try {
    appendPhoneHistory(session, { role: "user", content: utterance });
    const firstCompletion = await requestPhoneCompletion(session, true);
    if (!firstCompletion) {
      const fallback = "I'm sorry, I'm having trouble right now. Could you repeat that?";
      recordPhoneMessage(session, "agent", fallback);
      await speakToPlivo(session, fallback);
      return;
    }

    let assistantMessage = typeof firstCompletion.content === "string"
      ? firstCompletion.content.trim()
      : "";
    const toolCalls = readPhoneToolCalls(firstCompletion.tool_calls);

    if (session.finalizationStarted) return;

    if (toolCalls && toolCalls.length > 0) {
      appendPhoneHistory(session, {
        role: "assistant",
        content: assistantMessage || null,
        tool_calls: toolCalls,
      });
      if (!session.conversationId) {
        log.error({ callUuid, toolCount: toolCalls.length }, "Refusing phone tool calls without an audited conversation");
        const refusal = "I can't safely complete that action right now. Let me connect you with a human agent.";
        recordPhoneMessage(session, "agent", refusal);
        await speakToPlivo(session, refusal);
        return;
      }

      let actionClaimFailed = false;
      let blockedAction: "denied" | "escalated" | undefined;
      // Process tool calls through governance
      for (const [index, tc] of toolCalls.entries()) {
        if (session.finalizationStarted) return;
        const toolCall = tc;
        let toolArgs: Record<string, unknown>;
        try {
          const parsedArgs: unknown = JSON.parse(toolCall.function.arguments);
          if (!parsedArgs || typeof parsedArgs !== "object" || Array.isArray(parsedArgs)) {
            throw new Error("Tool arguments must be an object");
          }
          toolArgs = parsedArgs as Record<string, unknown>;
        } catch (err) {
          log.warn({ err, callUuid, toolCallId: toolCall.id }, "Failed to parse phone tool arguments");
          const refusal = "I couldn't safely understand that request. Let me connect you with a human agent.";
          recordPhoneMessage(session, "agent", refusal);
          await speakToPlivo(session, refusal);
          return;
        }
        const toolName = toMcpToolName(toolCall.function.name);
        const startedAt = Date.now();
        const riskScore = getRiskScore(toolName);
        const idempotencyKey = `plivo:${callUuid}:turn-${turnSequence}:tool-${index}`;

        if (session.conversationId) {
          try {
            const claim = await claimAgentAction({
              conversationId: session.conversationId,
              customerId: session.customerId,
              toolName,
              toolArgs,
              status: "policy_checking",
              confidence: 0.9,
              riskScore,
              sentimentAtTime: session.sentiment,
              idempotencyKey,
            });
            if (!claim.claimed) {
              log.warn({ callUuid, toolName }, "Duplicate phone action ignored");
              actionClaimFailed = true;
              break;
            }
          } catch (err) {
            log.error({ err, callUuid, toolName }, "Failed to claim phone action");
            actionClaimFailed = true;
            break;
          }
        }

        const result = await executeWithGovernance({
          toolName,
          toolArgs,
          confidence: 0.9,
          sentiment: session.sentiment,
          trustLevel: session.trustLevel,
          conversationId: session.conversationId,
          customerId: session.customerId,
        });

        if (result.decision === "deny") blockedAction = "denied";
        if (result.decision === "escalate" && blockedAction !== "denied") blockedAction = "escalated";

        log.info(
          { callUuid, toolName, decision: result.decision },
          "Phone channel governance result"
        );

        if (session.conversationId) {
          const durationMs = Date.now() - startedAt;
          const eventKind =
            result.decision === "allow"
              ? "tool_called"
              : result.decision === "escalate"
                ? "tool_escalated"
                : "tool_blocked";

          await Promise.all([
            upsertAgentAction({
              conversationId: session.conversationId,
              customerId: session.customerId,
              toolName,
              toolArgs,
              status:
                result.decision === "allow"
                  ? "executed"
                  : result.decision === "escalate"
                    ? "escalated"
                    : "blocked",
              confidence: 0.9,
              riskScore: result.riskScore,
              effectiveThreshold: result.effectiveThreshold,
              sentimentAtTime: session.sentiment,
              policyDecision: result.decision,
              policyReason: result.reason,
              armoriqTokenId: result.armoriqTokenId,
              armoriqPlanHash: result.armoriqPlanHash,
              armoriqVerified: result.armoriqVerified,
              result: result.toolResult,
              durationMs,
              idempotencyKey,
            }),
            recordConversationEvent(session.conversationId, eventKind, "agent", {
              toolName,
              reason: result.reason,
              verified: result.armoriqVerified ?? false,
            }),
          ]).catch((err) => {
            log.warn(
              { err, callUuid, toolName, conversationId: session.conversationId },
              "Failed to persist phone governance result"
            );
          });
        }

        appendPhoneHistory(session, {
          role: "tool",
          content: serializePhoneToolResult({ decision: result.decision, result: result.toolResult, reason: result.reason }),
          tool_call_id: toolCall.id,
        });
      }

      if (actionClaimFailed) {
        const refusal = "I can't safely complete that action right now. Let me connect you with a human agent.";
        recordPhoneMessage(session, "agent", refusal);
        await speakToPlivo(session, refusal);
        return;
      }

      if (blockedAction === "denied" || blockedAction === "escalated") {
        const refusal = blockedAction === "escalated"
          ? "That request needs human review before I can complete it. I'll connect you with a support agent."
          : "I can't complete that action automatically. I'll connect you with a support agent.";
        recordPhoneMessage(session, "agent", refusal);
        await speakToPlivo(session, refusal);
        return;
      }

      // Tool results must go back through MiniMax before anything is spoken.
      const followUp = await requestPhoneCompletion(session, false);
      if (!followUp) {
        const fallback = "I completed the safe part of that request, but I couldn't summarize the result. Let me connect you with a support agent.";
        recordPhoneMessage(session, "agent", fallback);
        await speakToPlivo(session, fallback);
        return;
      }
      assistantMessage = typeof followUp.content === "string" ? followUp.content.trim() : "";
      appendPhoneHistory(session, { role: "assistant", content: assistantMessage || null });
    } else {
      appendPhoneHistory(session, { role: "assistant", content: assistantMessage || null });
    }

    // Speak the response back via ElevenLabs TTS → Plivo
    if (assistantMessage) {
      recordPhoneMessage(session, "agent", assistantMessage);
      await speakToPlivo(session, assistantMessage);
    } else {
      const fallback = "I need a little more information before I can help. Could you say that another way?";
      recordPhoneMessage(session, "agent", fallback);
      await speakToPlivo(session, fallback);
    }
  } catch (err) {
    log.error({ err, callUuid }, "Error processing phone utterance");
    const fallback = "I encountered an issue. Let me transfer you to a human agent.";
    recordPhoneMessage(session, "agent", fallback);
    await speakToPlivo(session, fallback);
  }
}

function appendPhoneHistory(session: CallSession, message: PhoneHistoryMessage): void {
  session.phoneHistory.push(message);
  session.phoneHistoryChars += JSON.stringify(message).length;

  while (session.phoneHistoryChars > MAX_PHONE_HISTORY_CHARS && session.phoneHistory.length > 2) {
    const removed = session.phoneHistory.shift();
    if (!removed) break;
    session.phoneHistoryChars -= JSON.stringify(removed).length;

    // Keep an assistant tool-call message paired with its tool results.
    if (removed.role === "assistant" && removed.tool_calls?.length) {
      const toolCallIds = new Set(removed.tool_calls.map((toolCall) => toolCall.id));
      while (session.phoneHistory[0]?.role === "tool" && toolCallIds.has(session.phoneHistory[0].tool_call_id ?? "")) {
        const toolResult = session.phoneHistory.shift();
        if (toolResult) session.phoneHistoryChars -= JSON.stringify(toolResult).length;
      }
    }
  }
}

function readPhoneToolCalls(value: unknown): PhoneToolCall[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const record = candidate as Record<string, unknown>;
    const fn = record.function;
    if (!fn || typeof fn !== "object") return [];
    const functionRecord = fn as Record<string, unknown>;
    if (typeof functionRecord.name !== "string" || typeof functionRecord.arguments !== "string") return [];

    return [{
      id: typeof record.id === "string" && record.id ? record.id : `phone-tool-${index}`,
      type: "function" as const,
      function: {
        name: functionRecord.name,
        arguments: functionRecord.arguments,
      },
    }];
  });
}

function serializePhoneToolResult(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 4_000);
  } catch {
    return "The tool returned an unserializable result.";
  }
}

async function requestPhoneCompletion(
  session: CallSession,
  includeTools: boolean,
): Promise<{ content?: unknown; tool_calls?: unknown } | null> {
  const response = await fetchWithProviderPolicy(
    `${config.MINIMAX_BASE_URL}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.MINIMAX_API_KEY}`,
      },
      body: JSON.stringify({
        model: config.MINIMAX_MODEL,
        messages: [
          { role: "system", content: PHONE_SYSTEM_PROMPT },
          ...session.phoneHistory,
        ],
        ...(includeTools ? { tools: TOOL_FUNCTION_DEFINITIONS } : {}),
        temperature: 0.7,
        max_tokens: 512,
      }),
    },
    { timeoutMs: config.PROVIDER_TIMEOUT_MS, maxAttempts: 1 },
  );

  if (!response.ok) {
    log.error({ status: response.status, callUuid: session.callUuid }, "MiniMax failed for phone utterance");
    return null;
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown } }>;
  };
  return data.choices?.[0]?.message ?? null;
}

function recordPhoneMessage(
  session: CallSession,
  speaker: "customer" | "agent",
  text: string,
): void {
  const normalized = text.trim();
  if (!normalized) return;

  const remaining = MAX_SUMMARY_TRANSCRIPT_CHARS - session.summaryTranscriptChars;
  if (remaining > 0) {
    const bounded = normalized.slice(0, remaining);
    session.summaryTranscript.push({ speaker, text: bounded });
    session.summaryTranscriptChars += bounded.length;
  }

  if (session.conversationId) {
    recordMessage(session.conversationId, speaker, normalized).catch((err) => {
      log.warn(
        { err, callUuid: session.callUuid, conversationId: session.conversationId, speaker },
        "Failed to persist phone transcript message"
      );
    });
  }
}

async function generatePostCallSummary(session: CallSession): Promise<string | undefined> {
  if (!session.summaryTranscript.length) return undefined;

  const transcript = session.summaryTranscript
    .map(({ speaker, text }) => `${speaker === "customer" ? "Customer" : "Agent"}: ${text}`)
    .join("\n");
  const response = await fetchWithProviderPolicy(
    `${config.MINIMAX_BASE_URL}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.MINIMAX_API_KEY}`,
      },
      body: JSON.stringify({
        model: config.MINIMAX_MODEL,
        messages: [
          {
            role: "system",
            content:
              "Summarize this customer support call in at most three concise sentences. State the customer's request, actions actually taken, and any follow-up. Do not invent outcomes. Do not include phone numbers, email addresses, credentials, or other sensitive identifiers. Return only the summary text.",
          },
          { role: "user", content: transcript },
        ],
        temperature: 0.1,
        max_tokens: 180,
      }),
    },
    { timeoutMs: config.PROVIDER_TIMEOUT_MS, maxAttempts: 1 },
  );

  if (!response.ok) {
    log.warn({ status: response.status, callUuid: session.callUuid }, "MiniMax post-call summary failed");
    return undefined;
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") return undefined;

  const summary = content.replace(/\s+/g, " ").trim().slice(0, 1_200);
  return summary || undefined;
}

async function finalizePhoneSession(session: CallSession, reason: string): Promise<void> {
  if (session.finalizationStarted) return;
  session.finalizationStarted = true;
  session.audioGeneration += 1;
  session.isPlayingAudio = false;
  session.speechmatics?.endStream();
  session.speechmatics?.close();

  let summary: string | undefined;
  try {
    summary = await generatePostCallSummary(session);
  } catch (err) {
    log.warn({ err, callUuid: session.callUuid }, "Failed to generate post-call summary");
  }

  let smsStatus: "sent" | "failed" | "not_configured" | "no_destination" = "not_configured";
  if (summary && session.callerPhone) {
    if (config.PLIVO_AUTH_ID && config.PLIVO_AUTH_TOKEN && config.PLIVO_PHONE_NUMBER) {
      try {
        await sendPostCallSummary({ to: session.callerPhone, summary });
        smsStatus = "sent";
      } catch (err) {
        smsStatus = "failed";
        log.warn({ err, callUuid: session.callUuid }, "Failed to send post-call summary SMS");
      }
    }
  } else if (summary) {
    smsStatus = "no_destination";
  }

  if (!session.conversationId) return;

  await updateConversationStatus(session.conversationId, "completed", summary).catch((err) => {
    log.warn(
      { err, conversationId: session.conversationId, callUuid: session.callUuid },
      "Failed to mark phone conversation completed"
    );
  });

  await recordConversationEvent(
    session.conversationId,
    summary ? "summary_generated" : "channel_event",
    "system",
    summary
      ? { event: "post_call_summary", reason, smsStatus, characterCount: summary.length }
      : { event: "post_call_summary_unavailable", reason },
  ).catch((err) => {
    log.warn(
      { err, conversationId: session.conversationId, callUuid: session.callUuid },
      "Failed to persist post-call summary event"
    );
  });
}

/**
 * Send TTS audio to the caller via Plivo WebSocket.
 * Uses ElevenLabs Flash v2.5 with output_format=ulaw_8000.
 */
async function speakToPlivo(
  session: CallSession,
  text: string
): Promise<void> {
  const { callUuid } = session;
  const generation = ++session.audioGeneration;
  log.info({ callUuid, textLength: text.length }, "Speaking to Plivo caller");
  session.isPlayingAudio = true;

  let chunksSent = 0;
  try {
    await streamTts(text, (audioBase64) => {
      if (
        session.plivoWs.readyState === WebSocket.OPEN &&
        session.isPlayingAudio &&
        session.audioGeneration === generation
      ) {
        // Keep the JSON WebSocket frame below Plivo's 64KB limit even when
        // ElevenLabs produces a larger-than-usual streaming chunk. Base64
        // boundaries must stay on four-character multiples.
        const chunkSize = MAX_PLIVO_AUDIO_PAYLOAD_CHARS - (MAX_PLIVO_AUDIO_PAYLOAD_CHARS % 4);
        for (let offset = 0; offset < audioBase64.length; offset += chunkSize) {
          const payload = audioBase64.slice(offset, offset + chunkSize);
          chunksSent++;
          session.plivoWs.send(
            JSON.stringify({
              event: "playAudio",
              media: {
                contentType: "audio/x-mulaw",
                sampleRate: 8000,
                payload,
              },
            })
          );
        }
      }
    });
    log.info({ callUuid, chunksSent }, "Finished speaking to Plivo caller");
  } catch (err) {
    log.error(
      { err, callUuid },
      "ElevenLabs TTS failed, no fallback on phone channel"
    );
  } finally {
    if (session.audioGeneration === generation) {
      session.isPlayingAudio = false;
    }
  }
}

/**
 * Send clearAudio to Plivo (barge-in: stop current playback)
 */
function sendClearAudio(session: CallSession): void {
  if (session.plivoWs.readyState === WebSocket.OPEN) {
    log.info({ callUuid: session.callUuid }, "Barge-in: clearing audio");
    session.plivoWs.send(JSON.stringify({ event: "clearAudio" }));
  }
  session.audioGeneration += 1;
  session.isPlayingAudio = false;
}
