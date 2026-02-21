import WebSocket from "ws";
import pino from "pino";
import { config } from "../config.js";

const log = pino({ name: "speechmatics" });

export interface SpeechmaticsEvents {
  onPartialTranscript: (text: string) => void;
  onFinalTranscript: (text: string) => void;
  onEndOfUtterance: () => void;
  onSentiment: (sentiment: string) => void;
  onError: (error: Error) => void;
  onClose: () => void;
}

/**
 * Speechmatics Realtime STT client.
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

  constructor(callUuid: string, events: SpeechmaticsEvents) {
    this.callUuid = callUuid;
    this.events = events;
  }

  async connect(): Promise<void> {
    // Get temporary JWT for the Speechmatics realtime API
    const jwt = await this.getTemporaryJwt();

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(
        `wss://eu2.rt.speechmatics.com/v2`,
        {
          headers: { Authorization: `Bearer ${jwt}` },
        }
      );

      this.ws.on("open", () => {
        log.info({ callUuid: this.callUuid }, "Speechmatics WebSocket open");

        // Send StartRecognition message
        this.ws!.send(
          JSON.stringify({
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
          })
        );

        resolve();
      });

      this.ws.on("message", (data) => {
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

      this.ws.on("error", (err) => {
        log.error(
          { err, callUuid: this.callUuid },
          "Speechmatics WebSocket error"
        );
        this.events.onError(err instanceof Error ? err : new Error(String(err)));
        reject(err);
      });

      this.ws.on("close", () => {
        log.info({ callUuid: this.callUuid }, "Speechmatics WebSocket closed");
        this.events.onClose();
      });
    });
  }

  /** Send raw mulaw audio bytes to Speechmatics */
  sendAudio(audioBuffer: Buffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(audioBuffer);
    }
  }

  /** Send EndOfStream to gracefully close Speechmatics session */
  endStream(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ message: "EndOfStream", last_seq_no: 0 }));
    }
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }

  private handleMessage(msg: Record<string, unknown>): void {
    switch (msg.message) {
      case "RecognitionStarted":
        log.info({ callUuid: this.callUuid }, "Speechmatics recognition started");
        break;

      case "AddPartialTranscript": {
        // Display only — DO NOT act on partial transcripts (per CLAUDE.md)
        const partialText = (msg.metadata as Record<string, unknown>)?.transcript as string
          ?? this.extractTranscriptText(msg);
        const partialSentiment = this.extractSentiment(msg);
        if (partialSentiment) {
          this.events.onSentiment(partialSentiment);
        }
        if (partialText) {
          this.events.onPartialTranscript(partialText);
        }
        break;
      }

      case "AddTranscript": {
        // Final transcript — append to turn buffer
        const finalText = this.extractTranscriptText(msg);
        const finalSentiment = this.extractSentiment(msg);
        if (finalSentiment) {
          this.events.onSentiment(finalSentiment);
        }
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
          { msg, callUuid: this.callUuid },
          "Speechmatics error message"
        );
        this.events.onError(
          new Error(`Speechmatics error: ${JSON.stringify(msg)}`)
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

  private extractSentiment(msg: Record<string, unknown>): string | null {
    const metadata = msg.metadata as Record<string, unknown> | undefined;
    const sentiment = metadata?.sentiment;
    if (typeof sentiment === "string" && sentiment.trim().length > 0) {
      return sentiment;
    }
    return null;
  }

  private async getTemporaryJwt(): Promise<string> {
    const response = await fetch(
      "https://mp.speechmatics.com/v1/api_keys?type=rt",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.SPEECHMATICS_API_KEY}`,
        },
        body: JSON.stringify({ ttl: 3600 }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Speechmatics JWT request failed: ${response.status} ${await response.text()}`
      );
    }

    const data = (await response.json()) as { key_value: string };
    return data.key_value;
  }
}
