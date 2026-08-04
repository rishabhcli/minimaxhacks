import WebSocket from "ws";
import pino from "pino";
import { config } from "../config.js";
import { fetchWithProviderPolicy } from "../provider-http.js";

const log = pino({ name: "speechmatics" });
const MAX_PENDING_AUDIO_BYTES = 80_000;

export interface SpeechmaticsEvents {
  onPartialTranscript: (text: string) => void;
  onFinalTranscript: (text: string) => void;
  onEndOfUtterance: () => void;
  onError: (error: Error) => void;
  onClose: () => void;
}

export function buildStartRecognitionMessage(): Record<string, unknown> {
  return {
    message: "StartRecognition",
    transcription_config: {
      language: "en",
      enable_partials: true,
      max_delay: 2.0,
    },
    conversation_config: {
      end_of_utterance_silence_trigger: 0.5,
    },
    audio_format: {
      type: "raw",
      encoding: "mulaw",
      sample_rate: 8000,
    },
  };
}

/**
 * Speechmatics Realtime STT client. The realtime transcript payload does not
 * expose a supported sentiment field; the phone gateway performs a separate
 * MiniMax classification after each final utterance.
 * Audio format: mulaw 8kHz (raw, no container).
 *
 * Turn detection:
 * - AddPartialTranscript → display only, don't act
 * - AddTranscript → final text, append to turn buffer
 * - EndOfUtterance → close turn, process accumulated text
 */
export class SpeechmaticsClient {
  private ws: WebSocket | null = null;
  private events: SpeechmaticsEvents;
  private callUuid: string;
  private recognitionReady = false;
  private pendingAudio: Buffer[] = [];
  private pendingAudioBytes = 0;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((error: Error) => void) | null = null;

  constructor(callUuid: string, events: SpeechmaticsEvents) {
    this.callUuid = callUuid;
    this.events = events;
  }

  async connect(): Promise<void> {
    // Get temporary JWT for the Speechmatics realtime API
    const jwt = await this.getTemporaryJwt();

    return new Promise((resolve, reject) => {
      let settled = false;
      let connectTimeout: ReturnType<typeof setTimeout> | undefined;
      const resolveOnce = () => {
        if (settled) return;
        settled = true;
        if (connectTimeout) clearTimeout(connectTimeout);
        this.connectResolve = null;
        this.connectReject = null;
        resolve();
      };
      const rejectOnce = (error: Error) => {
        if (settled) return;
        settled = true;
        if (connectTimeout) clearTimeout(connectTimeout);
        this.connectResolve = null;
        this.connectReject = null;
        reject(error);
      };

      this.recognitionReady = false;
      this.pendingAudio = [];
      this.pendingAudioBytes = 0;
      this.connectResolve = resolveOnce;
      this.connectReject = rejectOnce;

      const ws = new WebSocket(
        `wss://eu2.rt.speechmatics.com/v2`,
        {
          headers: { Authorization: `Bearer ${jwt}` },
        }
      );
      this.ws = ws;
      connectTimeout = setTimeout(() => {
        const error = new Error("Speechmatics WebSocket connection timed out");
        ws.terminate();
        if (this.ws === ws) this.ws = null;
        this.events.onError(error);
        rejectOnce(error);
      }, config.PROVIDER_TIMEOUT_MS);

      ws.on("open", () => {
        if (settled) return;
        log.info({ callUuid: this.callUuid }, "Speechmatics WebSocket open");

        // Speechmatics requires StartRecognition before audio, then sends
        // RecognitionStarted when it is ready to receive the stream.
        ws.send(JSON.stringify(buildStartRecognitionMessage()));
      });

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch (err) {
          log.warn(
            { err, callUuid: this.callUuid },
            "Failed to parse Speechmatics message"
          );
        }
      });

      ws.on("error", (err) => {
        log.error(
          { err, callUuid: this.callUuid },
          "Speechmatics WebSocket error"
        );
        const error = err instanceof Error ? err : new Error(String(err));
        this.events.onError(error);
        rejectOnce(error);
      });

      ws.on("close", () => {
        rejectOnce(new Error("Speechmatics WebSocket closed before recognition started"));
        if (this.ws === ws) {
          this.ws = null;
          this.recognitionReady = false;
        }
        log.info({ callUuid: this.callUuid }, "Speechmatics WebSocket closed");
        this.events.onClose();
      });
    });
  }

  /** Send raw mulaw audio bytes to Speechmatics */
  sendAudio(audioBuffer: Buffer): void {
    if (!audioBuffer.length || this.ws?.readyState !== WebSocket.OPEN) return;

    if (!this.recognitionReady) {
      if (this.pendingAudioBytes + audioBuffer.length > MAX_PENDING_AUDIO_BYTES) {
        log.warn(
          {
            callUuid: this.callUuid,
            queuedBytes: this.pendingAudioBytes,
            droppedBytes: audioBuffer.length,
          },
          "Speechmatics readiness queue full; dropping audio frame"
        );
        return;
      }
      const copy = Buffer.from(audioBuffer);
      this.pendingAudio.push(copy);
      this.pendingAudioBytes += copy.length;
      return;
    }

    this.ws.send(audioBuffer);
  }

  private flushPendingAudio(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const pendingAudio = this.pendingAudio;
    this.pendingAudio = [];
    this.pendingAudioBytes = 0;
    for (const audioBuffer of pendingAudio) {
      ws.send(audioBuffer);
    }
  }

  /** Send EndOfStream to gracefully close Speechmatics session */
  endStream(): void {
    if (this.recognitionReady && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ message: "EndOfStream", last_seq_no: 0 }));
    }
  }

  close(): void {
    const ws = this.ws;
    this.pendingAudio = [];
    this.pendingAudioBytes = 0;
    this.recognitionReady = false;
    this.connectReject?.(new Error("Speechmatics client closed"));
    this.connectResolve = null;
    this.connectReject = null;
    ws?.close();
    this.ws = null;
  }

  private handleMessage(msg: Record<string, unknown>): void {
    switch (msg.message) {
      case "RecognitionStarted":
        log.info({ callUuid: this.callUuid }, "Speechmatics recognition started");
        this.recognitionReady = true;
        this.flushPendingAudio();
        this.connectResolve?.();
        break;

      case "AddPartialTranscript": {
        // Display only — DO NOT act on partial transcripts (per CLAUDE.md)
        const partialText = (msg.metadata as Record<string, unknown>)?.transcript as string
          ?? this.extractTranscriptText(msg);
        if (partialText) {
          this.events.onPartialTranscript(partialText);
        }
        break;
      }

      case "AddTranscript": {
        // Final transcript — append to turn buffer
        const finalText = this.extractTranscriptText(msg);
        if (finalText) {
          this.events.onFinalTranscript(finalText);
        }
        break;
      }

      case "EndOfUtterance":
        // Turn boundary — process the accumulated text
        this.events.onEndOfUtterance();
        break;

      case "AudioAdded":
        // Acknowledgement — no action needed
        break;

      case "EndOfTranscript":
        log.info({ callUuid: this.callUuid }, "Speechmatics end of transcript");
        break;

      case "Error":
        log.error(
          { messageType: msg.message, callUuid: this.callUuid },
          "Speechmatics error message"
        );
        this.events.onError(
          new Error("Speechmatics returned an error message")
        );
        break;

      default:
        log.debug(
          { messageType: msg.message, callUuid: this.callUuid },
          "Unhandled Speechmatics message"
        );
    }
  }

  private extractTranscriptText(msg: Record<string, unknown>): string {
    const results = msg.results as Array<{ alternatives?: Array<{ content?: string }> }> | undefined;
    if (!results?.length) return "";
    return results
      .map((r) => r.alternatives?.[0]?.content ?? "")
      .join(" ")
      .trim();
  }

  private async getTemporaryJwt(): Promise<string> {
    const response = await fetchWithProviderPolicy(
      "https://mp.speechmatics.com/v1/api_keys?type=rt",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.SPEECHMATICS_API_KEY}`,
        },
        body: JSON.stringify({ ttl: 3600 }),
      },
      { timeoutMs: config.PROVIDER_TIMEOUT_MS, maxAttempts: 1 },
    );

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Speechmatics JWT request failed: ${response.status}`);
    }

    const data = (await response.json()) as { key_value: string };
    return data.key_value;
  }
}
