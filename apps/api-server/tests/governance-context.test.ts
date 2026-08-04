import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveGovernanceContext } from "../src/vapi/governance-context.js";

describe("resolveGovernanceContext", () => {
  it("ignores client-provided trust, sentiment, and confidence by default", () => {
    const result = resolveGovernanceContext({
      sessionMeta: {
        trustLevel: 4,
        sentiment: "frustrated",
        confidence: 0.2,
        conversationId: "conv_123",
        customerId: "cust_456",
      },
      detectedSentiment: "neutral",
      allowClientOverrides: false,
    });

    assert.deepEqual(result, {
      trustLevel: 1,
      sentiment: "neutral",
      confidence: 0.9,
      conversationId: undefined,
      customerId: undefined,
    });
  });

  it("allows validated client overrides only when explicitly enabled", () => {
    const result = resolveGovernanceContext({
      sessionMeta: {
        trustLevel: 3,
        sentiment: "calm",
        confidence: 0.82,
      },
      detectedSentiment: "neutral",
      allowClientOverrides: true,
    });

    assert.deepEqual(result, {
      trustLevel: 3,
      sentiment: "calm",
      confidence: 0.82,
      conversationId: undefined,
      customerId: undefined,
    });
  });

  it("rejects malformed override values even when overrides are enabled", () => {
    const result = resolveGovernanceContext({
      sessionMeta: {
        trustLevel: 99,
        sentiment: "angry",
        confidence: 2,
      },
      detectedSentiment: "neutral",
      allowClientOverrides: true,
    });

    assert.deepEqual(result, {
      trustLevel: 1,
      sentiment: "neutral",
      confidence: 0.9,
      conversationId: undefined,
      customerId: undefined,
    });
  });

  it("prefers detected non-neutral sentiment over metadata overrides", () => {
    const result = resolveGovernanceContext({
      sessionMeta: {
        sentiment: "calm",
      },
      detectedSentiment: "frustrated",
      allowClientOverrides: true,
    });

    assert.equal(result.sentiment, "frustrated");
  });
});
