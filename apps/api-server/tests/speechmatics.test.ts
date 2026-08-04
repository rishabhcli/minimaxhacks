import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.CONVEX_URL = process.env.CONVEX_URL ?? "https://example.invalid";
process.env.MINIMAX_API_KEY = process.env.MINIMAX_API_KEY ?? "test-minimax";
process.env.MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN ?? "test-mcp-token";

const { buildStartRecognitionMessage } = await import("../src/plivo/speechmatics.js");

describe("Speechmatics start configuration", () => {
  it("uses the Plivo audio format and enables utterance boundaries", () => {
    const message = buildStartRecognitionMessage() as {
      message: string;
      transcription_config: { language: string; enable_partials: boolean; max_delay: number };
      conversation_config: { end_of_utterance_silence_trigger: number };
      audio_format: { type: string; encoding: string; sample_rate: number };
    };

    assert.equal(message.message, "StartRecognition");
    assert.deepEqual(message.transcription_config, {
      language: "en",
      enable_partials: true,
      max_delay: 2.0,
    });
    assert.equal(message.conversation_config.end_of_utterance_silence_trigger, 0.5);
    assert.deepEqual(message.audio_format, {
      type: "raw",
      encoding: "mulaw",
      sample_rate: 8000,
    });
  });
});
