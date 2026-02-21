import WebSocket, { WebSocketServer } from "ws";
import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import pino from "pino";
import { SpeechmaticsClient } from "./speechmatics.js";
import { streamTts } from "./elevenlabs.js";
import { config } from "../config.js";
import { executeWithGovernance } from "../policy/executor.js";
import {
  TOOL_FUNCTION_DEFINITIONS,
  toMcpToolName,
} from "../vapi/tool-definitions.js";
import type { Sentiment, TrustLevel } from "@shielddesk/shared";

const log = pino({ name: "plivo-gateway" });

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
  customerId?: string;
  conversationId?: string;
  turnFlushTimer: NodeJS.Timeout | null;
  playbackStartedAtMs: number | null;
  bargeInTriggered: boolean;
  llmFailures: number;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
}

interface MiniMaxToolCall {
  id?: string;
  function?: {
    name?: string;
    arguments?: unknown;
  };
}

interface ToolExecutionOutcome {
  toolName: string;
  decision: "allow" | "deny" | "escalate";
  reason: string;
  result?: unknown;
}

const PHONE_SYSTEM_PROMPT = `You are ShieldDesk, an AI customer support agent on a live phone call.

Rules:
- Be concise and conversational.
- Keep spoken replies short (one sentence unless the customer asks for detail).
- You already greeted the caller at call start. Do not re-introduce yourself.
- For any request needing data lookup or account/order action, call the appropriate tool.
- Never fabricate customer, order, ticket, or policy details.

Available tools:
- faq_search
- order_lookup
- account_lookup
- ticket_create
- ticket_escalate
- account_update
- order_refund`;

const PHONE_LLM_TEMPERATURE = 0.2;
const PHONE_LLM_MAX_TOKENS = 128;
const PHONE_LLM_TIMEOUT_MS = 3500;
const MAX_HISTORY_TURNS = 8;

/** Map of active sessions by streamId */
const sessions = new Map<string, CallSession>();

/**
 * Attach the Plivo WebSocket handler to an HTTP server.
 * Plivo connects to wss://PUBLIC_URL/plivo/ws with bidirectional audio streaming.
 *
 * ALL audio is mulaw 8kHz. No exceptions.
 */
export function attachPlivoWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  // Handle HTTP upgrade for /plivo/ws path
  server.on("upgrade", (request: IncomingMessage, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (url.pathname === "/plivo/ws") {
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
        log.info({ callUuid: session.callUuid }, "Plivo WebSocket closed");
        clearTurnFlushTimer(session);
        session.speechmatics?.endStream();
        session.speechmatics?.close();
        sessions.delete(session.streamId);
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
      const streamId =
        (typeof start?.streamId === "string" && start.streamId) ||
        (typeof start?.stream_id === "string" && start.stream_id) ||
        `stream-${Date.now()}`;
      const callUuid =
        (typeof start?.callId === "string" && start.callId) ||
        (typeof start?.callUuid === "string" && start.callUuid) ||
        (typeof start?.callUUID === "string" && start.callUUID) ||
        "unknown";

      log.info({ callUuid, streamId }, "Plivo stream started");

      const newSession: CallSession = {
        callUuid,
        streamId,
        plivoWs: ws,
        speechmatics: null,
        turnBuffer: [],
        isPlayingAudio: false,
        sentiment: "neutral",
        trustLevel: 2, // Default to authenticated; resolved in production via caller ID lookup
        customerId: undefined,
        conversationId: undefined,
        turnFlushTimer: null,
        playbackStartedAtMs: null,
        bargeInTriggered: false,
        llmFailures: 0,
        conversationHistory: [],
      };

      sessions.set(streamId, newSession);
      setSession(newSession);

      // Play greeting FIRST — caller should hear something immediately
      // Do this before Speechmatics so there's no dead air
      const greeting = "Hi, welcome to ShieldDesk support! How can I help you today?";
      speakToPlivo(newSession, greeting).catch(
        (err) => log.error({ err, callUuid }, "Failed to play greeting")
      );
      appendAssistantHistory(newSession, greeting);

      // Initialize Speechmatics STT connection in parallel with greeting
      try {
        const sttClient = new SpeechmaticsClient(callUuid, {
          onPartialTranscript: (text) => {
            // Display only — DO NOT act on partials (per CLAUDE.md)
            log.debug({ callUuid, text }, "Partial transcript");
            // Trigger barge-in only when we detect likely spoken words,
            // not on every inbound audio frame.
            if (shouldTriggerBargeIn(newSession, text)) {
              sendClearAudio(newSession);
              newSession.isPlayingAudio = false;
              newSession.bargeInTriggered = true;
            }
          },

          onFinalTranscript: (text) => {
            // Append to turn buffer — wait for EndOfUtterance
            if (text.trim()) {
              newSession.turnBuffer.push(text);
              log.info({ callUuid, text }, "Final transcript segment");
              // Fallback for cases where EndOfUtterance is delayed or missed.
              scheduleTurnFlush(newSession);
            }
          },

          onEndOfUtterance: () => {
            // Turn complete — process accumulated text
            flushTurnBuffer(newSession, "end_of_utterance");
          },

          onSentiment: (sentiment) => {
            newSession.sentiment = sentiment as Sentiment;
            log.info({ callUuid, sentiment }, "Sentiment updated");
          },

          onError: (error) => {
            log.error({ err: error, callUuid }, "Speechmatics error");
          },

          onClose: () => {
            log.info({ callUuid }, "Speechmatics connection closed");
          },
        });

        await sttClient.connect();
        newSession.speechmatics = sttClient;
        log.info({ callUuid }, "Speechmatics connected successfully");
      } catch (err) {
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

      // Forward raw mulaw bytes to Speechmatics
      session.speechmatics.sendAudio(audioBuffer);
      break;
    }

    case "dtmf": {
      const dtmf = msg.dtmf as Record<string, unknown>;
      log.info(
        { callUuid: session?.callUuid, digit: dtmf?.digit },
        "DTMF received"
      );
      break;
    }

    case "stop": {
      log.info({ callUuid: session?.callUuid }, "Plivo stream stopped");
      if (session) clearTurnFlushTimer(session);
      session?.speechmatics?.endStream();
      break;
    }

    default:
      log.debug(
        { event, callUuid: session?.callUuid },
        "Unknown Plivo stream event"
      );
  }
}

/**
 * Process a complete customer utterance (after EndOfUtterance).
 * Send to MiniMax for intent extraction → policy → execute → TTS response.
 */
async function processUtterance(
  session: CallSession,
  utterance: string
): Promise<void> {
  const { callUuid } = session;

  try {
    // Call MiniMax M2.5 for intent extraction + response
    const llmResponse = await fetch(
      `${config.MINIMAX_BASE_URL}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.MINIMAX_API_KEY}`,
        },
        signal: AbortSignal.timeout(PHONE_LLM_TIMEOUT_MS),
        body: JSON.stringify({
          model: config.MINIMAX_MODEL,
          messages: [
            {
              role: "system",
              content: PHONE_SYSTEM_PROMPT,
            },
            ...session.conversationHistory,
            { role: "user", content: utterance },
          ],
          tools: TOOL_FUNCTION_DEFINITIONS,
          temperature: PHONE_LLM_TEMPERATURE,
          max_tokens: PHONE_LLM_MAX_TOKENS,
        }),
      }
    );

    if (!llmResponse.ok) {
      session.llmFailures += 1;
      log.error(
        { status: llmResponse.status, callUuid },
        "MiniMax failed for phone utterance"
      );
      await speakToPlivo(
        session,
        "I'm having trouble right now. Please repeat that."
      );
      return;
    }
    session.llmFailures = 0;

    const data = (await llmResponse.json()) as {
      choices: Array<{
        message: { content?: string; tool_calls?: Array<MiniMaxToolCall> };
      }>;
    };

    const assistantMessage = data.choices?.[0]?.message?.content;
    const toolCalls = data.choices?.[0]?.message?.tool_calls;
    const toolOutcomes: ToolExecutionOutcome[] = [];

    if (toolCalls && toolCalls.length > 0) {
      // Process tool calls through governance
      for (const tc of toolCalls) {
        const rawName = tc.function?.name;
        const rawArgs = tc.function?.arguments;
        if (!rawName) {
          log.warn({ callUuid, toolCall: tc }, "Tool call missing name");
          continue;
        }

        const toolName = toMcpToolName(rawName);

        let toolArgs: Record<string, unknown>;
        try {
          if (typeof rawArgs === "string") {
            const parsed = JSON.parse(rawArgs) as unknown;
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
              throw new Error("tool arguments must be an object");
            }
            toolArgs = parsed as Record<string, unknown>;
          } else if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
            toolArgs = rawArgs as Record<string, unknown>;
          } else if (rawArgs === undefined || rawArgs === null) {
            toolArgs = {};
          } else {
            throw new Error("tool arguments must be a JSON object");
          }
        } catch (parseErr) {
          log.warn(
            { callUuid, rawName, rawArgs, err: parseErr },
            "Invalid tool arguments in phone channel"
          );
          toolOutcomes.push({
            toolName,
            decision: "deny",
            reason: "Tool arguments were invalid and could not be parsed.",
          });
          continue;
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

        log.info(
          { callUuid, toolName, decision: result.decision },
          "Phone channel governance result"
        );

        toolOutcomes.push({
          toolName,
          decision: result.decision,
          reason: result.reason,
          result: result.toolResult,
        });
      }
    }

    const spokenResponse = generatePhoneResponse({
      assistantDraft: assistantMessage,
      toolOutcomes,
    });

    // Speak the response back via ElevenLabs TTS → Plivo
    if (spokenResponse) {
      await speakToPlivo(session, spokenResponse);
      appendUserHistory(session, utterance);
      appendAssistantHistory(session, spokenResponse);
    }
  } catch (err) {
    session.llmFailures += 1;
    log.error({ err, callUuid }, "Error processing phone utterance");
    await speakToPlivo(
      session,
      "I hit a temporary issue. Please repeat your request."
    );
  }
}

function scheduleTurnFlush(session: CallSession): void {
  clearTurnFlushTimer(session);
  session.turnFlushTimer = setTimeout(() => {
    flushTurnBuffer(session, "timeout_fallback");
  }, 1100);
}

function clearTurnFlushTimer(session: CallSession): void {
  if (session.turnFlushTimer) {
    clearTimeout(session.turnFlushTimer);
    session.turnFlushTimer = null;
  }
}

function flushTurnBuffer(
  session: CallSession,
  reason: "end_of_utterance" | "timeout_fallback"
): void {
  clearTurnFlushTimer(session);
  const fullUtterance = session.turnBuffer.join(" ").trim();
  session.turnBuffer = [];
  if (!fullUtterance) return;

  log.info(
    { callUuid: session.callUuid, reason, fullUtterance },
    "Turn complete"
  );

  processUtterance(session, fullUtterance).catch((err) => {
    log.error(
      { err, callUuid: session.callUuid },
      "Failed to process utterance"
    );
  });
}

function generatePhoneResponse(input: {
  assistantDraft?: string;
  toolOutcomes: ToolExecutionOutcome[];
}): string {
  const { assistantDraft, toolOutcomes } = input;
  if (toolOutcomes.length === 0) {
    return stripThinkBlocks(assistantDraft) ??
      "I can help with that. Could you repeat that request?";
  }

  // For phone latency, avoid a second LLM round-trip after tool execution.
  const cleanedDraft = stripThinkBlocks(assistantDraft);
  if (cleanedDraft) {
    return cleanedDraft;
  }

  return buildDeterministicOutcomeSummary(toolOutcomes);
}

function stripThinkBlocks(text: string | undefined): string | null {
  if (typeof text !== "string") return null;
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

function appendUserHistory(session: CallSession, content: string): void {
  appendHistory(session, { role: "user", content });
}

function appendAssistantHistory(session: CallSession, content: string): void {
  appendHistory(session, { role: "assistant", content });
}

function appendHistory(
  session: CallSession,
  item: { role: "user" | "assistant"; content: string }
): void {
  const text = item.content.trim();
  if (!text) return;
  session.conversationHistory.push({ role: item.role, content: text });
  if (session.conversationHistory.length > MAX_HISTORY_TURNS) {
    session.conversationHistory = session.conversationHistory.slice(
      session.conversationHistory.length - MAX_HISTORY_TURNS
    );
  }
}

function buildDeterministicOutcomeSummary(
  outcomes: ToolExecutionOutcome[]
): string {
  const hasEscalation = outcomes.some((o) => o.decision === "escalate");
  const hasDenial = outcomes.some((o) => o.decision === "deny");
  const hasAllow = outcomes.some((o) => o.decision === "allow");

  if (hasAllow && !hasEscalation && !hasDenial) {
    return "Done. I completed that request.";
  }
  if (hasEscalation && !hasAllow && !hasDenial) {
    return "I need to route that to a human agent for approval.";
  }
  if (hasDenial && !hasAllow && !hasEscalation) {
    return "I can't perform that action automatically due to security policy.";
  }
  return "I completed the safe parts and escalated the rest for human review.";
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
  log.info({ callUuid, textLength: text.length, text: text.substring(0, 80) }, "Speaking to Plivo caller");
  session.isPlayingAudio = true;
  session.playbackStartedAtMs = Date.now();
  session.bargeInTriggered = false;

  let chunksSent = 0;
  try {
    await streamTts(text, (audioBase64) => {
      if (
        session.plivoWs.readyState === WebSocket.OPEN &&
        session.isPlayingAudio
      ) {
        chunksSent++;
        // Send audio chunk to Plivo
        // Plivo expects: { event: "playAudio", media: { payload: base64, contentType, sampleRate } }
        session.plivoWs.send(
          JSON.stringify({
            event: "playAudio",
            media: {
              contentType: "audio/x-mulaw",
              sampleRate: 8000,
              payload: audioBase64,
            },
          })
        );
      }
    });
    log.info({ callUuid, chunksSent }, "Finished speaking to Plivo caller");
  } catch (err) {
    log.error(
      { err, callUuid },
      "ElevenLabs TTS failed, no fallback on phone channel"
    );
  } finally {
    session.isPlayingAudio = false;
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
}

function shouldTriggerBargeIn(session: CallSession, partialText: string): boolean {
  if (!session.isPlayingAudio || session.bargeInTriggered) return false;
  const started = session.playbackStartedAtMs ?? 0;
  // Avoid clearing immediately due to line noise right as playback starts.
  if (Date.now() - started < 450) return false;

  const text = partialText.trim();
  if (text.length < 3) return false;
  // Require at least one alphanumeric to filter punctuation/noise fragments.
  return /[a-z0-9]/i.test(text);
}
