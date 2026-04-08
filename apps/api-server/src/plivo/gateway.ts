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
  updateConversationSentiment,
  updateConversationStatus,
  upsertAgentAction,
} from "../conversation-audit.js";
import { toMcpToolName } from "../vapi/tool-definitions.js";
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
  const wss = new WebSocketServer({ noServer: true });

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
        closedSession.speechmatics?.endStream();
        closedSession.speechmatics?.close();
        if (closedSession.conversationId) {
          updateConversationStatus(closedSession.conversationId, "completed").catch((err) => {
            log.warn(
              {
                err,
                conversationId: closedSession.conversationId,
                callUuid: closedSession.callUuid,
              },
              "Failed to mark phone conversation completed on socket close"
            );
          });
        }
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

      log.info({ callUuid, streamId, callerPhone }, "Plivo stream started");

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
          log.warn({ err, callUuid, callerPhone }, "Failed to resolve caller identity");
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
            callerPhone: callerPhone ?? null,
          }
        );
      } catch (err) {
        log.warn({ err, callUuid }, "Failed to persist phone conversation start");
      }

      sessions.set(streamId, newSession);
      setSession(newSession);

      // Play greeting FIRST — caller should hear something immediately
      // Do this before Speechmatics so there's no dead air
      speakToPlivo(newSession, "Hi, welcome to ShieldDesk support! How can I help you today?").catch(
        (err) => log.error({ err, callUuid }, "Failed to play greeting")
      );

      // Initialize Speechmatics STT connection in parallel with greeting
      try {
        const sttClient = new SpeechmaticsClient(callUuid, {
          onPartialTranscript: (text) => {
            // Display only — DO NOT act on partials (per CLAUDE.md)
            log.debug({ callUuid, text }, "Partial transcript");
          },

          onFinalTranscript: (text) => {
            // Append to turn buffer — wait for EndOfUtterance
            if (text.trim()) {
              newSession.turnBuffer.push(text);
              log.info({ callUuid, text }, "Final transcript segment");
            }
          },

          onEndOfUtterance: () => {
            // Turn complete — process accumulated text
            const fullUtterance = newSession.turnBuffer.join(" ").trim();
            newSession.turnBuffer = [];

            if (fullUtterance) {
              log.info({ callUuid, fullUtterance }, "Turn complete");
              if (newSession.conversationId) {
                recordMessage(newSession.conversationId, "customer", fullUtterance).catch(
                  (err) => {
                    log.warn(
                      { err, callUuid, conversationId: newSession.conversationId },
                      "Failed to persist phone customer utterance"
                    );
                  }
                );
              }
              processUtterance(newSession, fullUtterance).catch((err) => {
                log.error({ err, callUuid }, "Failed to process utterance");
              });
            }
          },

          onSentiment: (sentiment) => {
            const previous = newSession.sentiment;
            newSession.sentiment = sentiment as Sentiment;
            log.info({ callUuid, sentiment }, "Sentiment updated");
            if (newSession.conversationId) {
              updateConversationSentiment(
                newSession.conversationId,
                previous,
                newSession.sentiment
              ).catch((err) => {
                log.warn(
                  { err, callUuid, conversationId: newSession.conversationId },
                  "Failed to persist phone sentiment change"
                );
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
        { callUuid: session?.callUuid, digit: dtmf?.digit },
        "DTMF received"
      );
      break;
    }

    case "stop": {
      log.info({ callUuid: session?.callUuid }, "Plivo stream stopped");
      session?.speechmatics?.endStream();
      if (session?.conversationId) {
        await Promise.all([
          recordConversationEvent(session.conversationId, "channel_event", "system", {
            event: "stop",
          }),
          updateConversationStatus(session.conversationId, "completed"),
        ]).catch((err) => {
          log.warn(
            { err, conversationId: session.conversationId, callUuid: session.callUuid },
            "Failed to persist phone stop event"
          );
        });
      }
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
        body: JSON.stringify({
          model: config.MINIMAX_MODEL,
          messages: [
            {
              role: "system",
              content:
                "You are ShieldDesk, a customer support agent on a phone call. Keep responses concise and conversational.",
            },
            { role: "user", content: utterance },
          ],
          temperature: 0.7,
          max_tokens: 512,
        }),
      }
    );

    if (!llmResponse.ok) {
      log.error(
        { status: llmResponse.status, callUuid },
        "MiniMax failed for phone utterance"
      );
      await speakToPlivo(
        session,
        "I'm sorry, I'm having trouble right now. Could you repeat that?"
      );
      return;
    }

    const data = (await llmResponse.json()) as {
      choices: Array<{
        message: { content?: string; tool_calls?: Array<unknown> };
      }>;
    };

    const assistantMessage = data.choices?.[0]?.message?.content;
    const toolCalls = data.choices?.[0]?.message?.tool_calls;

    if (toolCalls && toolCalls.length > 0) {
      // Process tool calls through governance
      for (const [index, tc] of toolCalls.entries()) {
        const toolCall = tc as {
          function: { name: string; arguments: string };
        };
        const toolArgs = JSON.parse(toolCall.function.arguments);
        const toolName = toMcpToolName(toolCall.function.name);
        const startedAt = Date.now();
        const riskScore = getRiskScore(toolName);
        const idempotencyKey = `plivo:${callUuid}:${startedAt}:${index}`;

        if (session.conversationId) {
          await upsertAgentAction({
            conversationId: session.conversationId,
            customerId: session.customerId,
            toolName,
            toolArgs,
            status: "policy_checking",
            confidence: 0.9,
            riskScore,
            sentimentAtTime: session.sentiment,
            idempotencyKey,
          }).catch((err) => {
            log.warn(
              { err, callUuid, toolName },
              "Failed to persist phone policy-checking action"
            );
          });
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
      }
    }

    // Speak the response back via ElevenLabs TTS → Plivo
    if (assistantMessage) {
      if (session.conversationId) {
        await recordMessage(session.conversationId, "agent", assistantMessage).catch(
          (err) => {
            log.warn(
              { err, callUuid, conversationId: session.conversationId },
              "Failed to persist phone agent response"
            );
          }
        );
      }
      await speakToPlivo(session, assistantMessage);
    }
  } catch (err) {
    log.error({ err, callUuid }, "Error processing phone utterance");
    await speakToPlivo(
      session,
      "I encountered an issue. Let me transfer you to a human agent."
    );
  }
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
