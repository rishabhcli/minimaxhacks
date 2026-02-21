import type { Sentiment, TrustLevel } from "@shielddesk/shared";
import {
  SENTIMENT_MULTIPLIERS,
  TRUST_CEILINGS,
} from "@shielddesk/shared";

export type PolicyDecisionKind = "allow" | "deny" | "escalate";

export interface PolicyInput {
  /** LLM confidence in intent extraction (0-1) */
  confidence: number;
  /** Pre-assigned risk for this tool (0-1) */
  riskScore: number;
  /** Customer sentiment from ASR analysis */
  sentiment: Sentiment;
  /** Customer trust level (1-4) */
  trustLevel: TrustLevel;
}

export interface PolicyDecision {
  decision: PolicyDecisionKind;
  reason: string;
  effectiveThreshold: number;
  confidence: number;
  riskScore: number;
}

/**
 * The decision function: f(confidence, risk, sentiment, trust_level) → allow | deny | escalate
 *
 * Decision logic (from PRD):
 *   effectiveThreshold = trustCeiling[trustLevel] * sentimentMultiplier[sentiment]
 *   - If risk >= 0.95 → DENY always (destructive actions)
 *   - If confidence < 0.70 → ESCALATE always (agent unsure)
 *   - If risk < effectiveThreshold AND confidence >= 0.85 → ALLOW
 *   - Otherwise → ESCALATE
 */
export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const { confidence, riskScore, sentiment, trustLevel } = input;

  const ceiling = TRUST_CEILINGS[trustLevel];
  const multiplier = SENTIMENT_MULTIPLIERS[sentiment];
  const effectiveThreshold = ceiling * multiplier;

  const base = { effectiveThreshold, confidence, riskScore };

  // Rule 1: Destructive actions (risk >= 0.95) → always DENY
  if (riskScore >= 0.95) {
    return {
      ...base,
      decision: "deny",
      reason: `Risk score ${riskScore} >= 0.95 — destructive action, always denied`,
    };
  }

  // Rule 2: Low confidence (< 0.70) → always ESCALATE
  if (confidence < 0.70) {
    return {
      ...base,
      decision: "escalate",
      reason: `Confidence ${confidence} < 0.70 — agent unsure, requires human review`,
    };
  }

  // Rule 3: Risk below threshold AND high confidence → ALLOW
  if (riskScore < effectiveThreshold && confidence >= 0.85) {
    return {
      ...base,
      decision: "allow",
      reason: `Risk ${riskScore} < threshold ${effectiveThreshold.toFixed(3)} and confidence ${confidence} >= 0.85 — approved`,
    };
  }

  // Rule 4: Everything else → ESCALATE
  return {
    ...base,
    decision: "escalate",
    reason: `Risk ${riskScore} >= threshold ${effectiveThreshold.toFixed(3)} or confidence ${confidence} < 0.85 — requires human review`,
  };
}
