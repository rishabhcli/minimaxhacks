import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluatePolicy } from "../src/policy/decision.js";
import { getRiskScore, TOOL_RISK_SCORES } from "../src/policy/risk-scores.js";

// ── Risk scores tests ──

describe("getRiskScore", () => {
  it("returns known tool scores", () => {
    assert.equal(getRiskScore("faq.search"), 0.02);
    assert.equal(getRiskScore("order.lookup"), 0.05);
    assert.equal(getRiskScore("order.list"), 0.05);
    assert.equal(getRiskScore("account.lookup"), 0.08);
    assert.equal(getRiskScore("ticket.create"), 0.10);
    assert.equal(getRiskScore("ticket.escalate"), 0.15);
    assert.equal(getRiskScore("account.update"), 0.40);
    assert.equal(getRiskScore("order.refund"), 0.60);
    assert.equal(getRiskScore("account.delete"), 1.00);
  });

  it("returns 1.0 for unknown tools (fail closed)", () => {
    assert.equal(getRiskScore("unknown.tool"), 1.0);
    assert.equal(getRiskScore(""), 1.0);
  });
});

// ── Decision function tests ──

describe("evaluatePolicy", () => {
  // ── PRD example: Authenticated + frustrated + order.lookup → ALLOW ──
  // Risk 0.05, ceiling 0.40, multiplier 1.4 → threshold 0.56
  // 0.05 < 0.56 AND confidence 0.95 >= 0.85 → ALLOW
  it("Authenticated + frustrated + order.lookup → ALLOW", () => {
    const result = evaluatePolicy({
      confidence: 0.95,
      riskScore: 0.05,
      sentiment: "frustrated",
      trustLevel: 2,
    });
    assert.equal(result.decision, "allow");
    assert.ok(
      Math.abs(result.effectiveThreshold - 0.56) < 0.001,
      `Expected threshold ~0.56, got ${result.effectiveThreshold}`
    );
  });

  // ── PRD example: Authenticated + frustrated + order.refund → ESCALATE ──
  // Risk 0.60, ceiling 0.40, multiplier 1.4 → threshold 0.56
  // 0.60 >= 0.56 → ESCALATE
  it("Authenticated + frustrated + order.refund → ESCALATE", () => {
    const result = evaluatePolicy({
      confidence: 0.88,
      riskScore: 0.60,
      sentiment: "frustrated",
      trustLevel: 2,
    });
    assert.equal(result.decision, "escalate");
    assert.ok(
      Math.abs(result.effectiveThreshold - 0.56) < 0.001,
      `Expected threshold ~0.56, got ${result.effectiveThreshold}`
    );
  });

  // ── PRD example: VIP + frustrated + order.refund → ALLOW ──
  // Risk 0.60, ceiling 0.85, multiplier 1.4 → threshold 1.19
  // 0.60 < 1.19 AND confidence 0.92 >= 0.85 → ALLOW
  it("VIP + frustrated + order.refund → ALLOW", () => {
    const result = evaluatePolicy({
      confidence: 0.92,
      riskScore: 0.60,
      sentiment: "frustrated",
      trustLevel: 4,
    });
    assert.equal(result.decision, "allow");
    assert.ok(
      Math.abs(result.effectiveThreshold - 1.19) < 0.001,
      `Expected threshold ~1.19, got ${result.effectiveThreshold}`
    );
  });

  // ── Any trust + any sentiment + account.delete → DENY ──
  // Risk 1.0 >= 0.95 → DENY always
  it("account.delete always DENY regardless of trust/sentiment", () => {
    for (const trustLevel of [1, 2, 3, 4] as const) {
      for (const sentiment of [
        "frustrated",
        "neutral",
        "satisfied",
        "calm",
      ] as const) {
        const result = evaluatePolicy({
          confidence: 0.99,
          riskScore: 1.0,
          sentiment,
          trustLevel,
        });
        assert.equal(
          result.decision,
          "deny",
          `Expected DENY for trust=${trustLevel}, sentiment=${sentiment}`
        );
      }
    }
  });

  // ── Low confidence → ESCALATE always ──
  it("Low confidence (0.55) → ESCALATE regardless of risk/trust", () => {
    const result = evaluatePolicy({
      confidence: 0.55,
      riskScore: 0.02, // faq.search — lowest risk
      sentiment: "frustrated",
      trustLevel: 4, // VIP — highest trust
    });
    assert.equal(result.decision, "escalate");
    assert.ok(result.reason.includes("Confidence"));
  });

  // ── Confidence exactly 0.70 → not escalated by low-confidence rule ──
  it("Confidence exactly 0.70 is NOT caught by low-confidence rule", () => {
    const result = evaluatePolicy({
      confidence: 0.70,
      riskScore: 0.02,
      sentiment: "frustrated",
      trustLevel: 4,
    });
    // 0.70 is NOT < 0.70, so it goes to rule 3/4
    // But 0.70 < 0.85, so it's NOT allowed → ESCALATE via rule 4
    assert.equal(result.decision, "escalate");
    assert.ok(!result.reason.includes("agent unsure"));
  });

  // ── Confidence exactly 0.85 allows execution ──
  it("Confidence exactly 0.85 allows when risk < threshold", () => {
    const result = evaluatePolicy({
      confidence: 0.85,
      riskScore: 0.02,
      sentiment: "neutral",
      trustLevel: 2, // ceiling 0.4, threshold 0.4
    });
    // risk 0.02 < 0.4 AND confidence 0.85 >= 0.85 → ALLOW
    assert.equal(result.decision, "allow");
  });

  // ── Anonymous user can barely do anything ──
  it("Anonymous (trust=1) + neutral: only very low risk allowed", () => {
    // Ceiling 0.10 * 1.0 = 0.10 threshold
    // faq.search risk 0.02 < 0.10 → ALLOW
    const faqResult = evaluatePolicy({
      confidence: 0.95,
      riskScore: 0.02,
      sentiment: "neutral",
      trustLevel: 1,
    });
    assert.equal(faqResult.decision, "allow");

    // order.lookup risk 0.05 < 0.10 → ALLOW
    const lookupResult = evaluatePolicy({
      confidence: 0.95,
      riskScore: 0.05,
      sentiment: "neutral",
      trustLevel: 1,
    });
    assert.equal(lookupResult.decision, "allow");

    // account.lookup risk 0.08 < 0.10 → ALLOW
    const accountResult = evaluatePolicy({
      confidence: 0.95,
      riskScore: 0.08,
      sentiment: "neutral",
      trustLevel: 1,
    });
    assert.equal(accountResult.decision, "allow");

    // ticket.create risk 0.10 — NOT < 0.10 → ESCALATE
    const ticketResult = evaluatePolicy({
      confidence: 0.95,
      riskScore: 0.10,
      sentiment: "neutral",
      trustLevel: 1,
    });
    assert.equal(ticketResult.decision, "escalate");
  });

  // ── Sentiment modifiers correctly shift threshold ──
  it("Sentiment modifiers: frustrated expands, calm contracts", () => {
    // Premium (ceiling 0.65):
    //   frustrated: 0.65 * 1.4 = 0.91
    //   calm:       0.65 * 0.8 = 0.52
    const frustrated = evaluatePolicy({
      confidence: 0.90,
      riskScore: 0.60,
      sentiment: "frustrated",
      trustLevel: 3,
    });
    // 0.60 < 0.91 → ALLOW
    assert.equal(frustrated.decision, "allow");

    const calm = evaluatePolicy({
      confidence: 0.90,
      riskScore: 0.60,
      sentiment: "calm",
      trustLevel: 3,
    });
    // 0.60 >= 0.52 → ESCALATE
    assert.equal(calm.decision, "escalate");
  });

  // ── Risk exactly 0.95 → DENY ──
  it("Risk exactly 0.95 triggers DENY", () => {
    const result = evaluatePolicy({
      confidence: 0.99,
      riskScore: 0.95,
      sentiment: "frustrated",
      trustLevel: 4,
    });
    assert.equal(result.decision, "deny");
  });

  // ── Moderate confidence (0.80) with low risk → ESCALATE (conf < 0.85) ──
  it("Confidence 0.80 with low risk still ESCALATE (below 0.85)", () => {
    const result = evaluatePolicy({
      confidence: 0.80,
      riskScore: 0.02,
      sentiment: "neutral",
      trustLevel: 4,
    });
    assert.equal(result.decision, "escalate");
  });

  // ── Effective threshold values ──
  it("Computes correct effective thresholds", () => {
    // Trust 1 (0.10) * neutral (1.0) = 0.10
    const r1 = evaluatePolicy({
      confidence: 0.95,
      riskScore: 0.02,
      sentiment: "neutral",
      trustLevel: 1,
    });
    assert.ok(Math.abs(r1.effectiveThreshold - 0.10) < 0.001);

    // Trust 2 (0.40) * satisfied (0.9) = 0.36
    const r2 = evaluatePolicy({
      confidence: 0.95,
      riskScore: 0.02,
      sentiment: "satisfied",
      trustLevel: 2,
    });
    assert.ok(Math.abs(r2.effectiveThreshold - 0.36) < 0.001);

    // Trust 3 (0.65) * calm (0.8) = 0.52
    const r3 = evaluatePolicy({
      confidence: 0.95,
      riskScore: 0.02,
      sentiment: "calm",
      trustLevel: 3,
    });
    assert.ok(Math.abs(r3.effectiveThreshold - 0.52) < 0.001);

    // Trust 4 (0.85) * frustrated (1.4) = 1.19
    const r4 = evaluatePolicy({
      confidence: 0.95,
      riskScore: 0.02,
      sentiment: "frustrated",
      trustLevel: 4,
    });
    assert.ok(Math.abs(r4.effectiveThreshold - 1.19) < 0.001);
  });
});
