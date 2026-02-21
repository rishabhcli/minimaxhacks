import pino from "pino";
import { config } from "../config.js";

const log = pino({ name: "elevenlabs-tts" });

/**
 * ElevenLabs streaming TTS.
 * Output format: ulaw_8000 (mulaw 8kHz) — matches Plivo pipeline requirement.
 *
 * CRITICAL: ALL audio in the Plivo pipeline MUST be mulaw 8kHz.
 * ElevenLabs `output_format=ulaw_8000` ensures this.
 */
export async function streamTts(
  text: string,
  onChunk: (audioBase64: string) => void
): Promise<void> {
  const voiceId = config.ELEVENLABS_VOICE_ID;
  if (!voiceId) {
    log.warn("ELEVENLABS_VOICE_ID not set, skipping TTS");
    return;
  }

  log.info({ textLength: text.length, voiceId }, "Starting TTS synthesis");

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=ulaw_8000`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": config.ELEVENLABS_API_KEY,
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_flash_v2_5",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    log.error(
      { status: response.status, body: errText },
      "ElevenLabs TTS error"
    );
    throw new Error(`ElevenLabs TTS failed: ${response.status}`);
  }

  if (!response.body) {
    throw new Error("ElevenLabs TTS returned no body");
  }

  // Stream audio chunks — each chunk is raw mulaw 8kHz bytes
  const reader = response.body.getReader();
  let chunkCount = 0;
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length > 0) {
        chunkCount++;
        totalBytes += value.length;
        // Convert to base64 for Plivo playAudio
        const base64 = Buffer.from(value).toString("base64");
        onChunk(base64);
      }
    }
  } finally {
    reader.releaseLock();
    log.info({ chunkCount, totalBytes }, "TTS stream complete");
  }
}

/**
 * Non-streaming TTS — fetches complete audio buffer.
 * Returns base64-encoded mulaw 8kHz audio.
 */
export async function synthesizeTts(text: string): Promise<string> {
  const chunks: string[] = [];
  await streamTts(text, (chunk) => chunks.push(chunk));
  // Concatenate all base64 chunks into a single buffer, then re-encode
  const fullBuffer = Buffer.concat(
    chunks.map((c) => Buffer.from(c, "base64"))
  );
  return fullBuffer.toString("base64");
}
