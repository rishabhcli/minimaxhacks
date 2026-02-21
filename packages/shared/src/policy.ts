import { z } from "zod";

// ── Sentiment ──

export const SentimentSchema = z.enum([
  "frustrated",
  "neutral",
  "satisfied",
  "calm",
]);
export type Sentiment = z.infer<typeof SentimentSchema>;

export const SENTIMENT_MULTIPLIERS: Record<Sentiment, number> = {
  frustrated: 1.4,
  neutral: 1.0,
  satisfied: 0.9,
  calm: 0.8,
} as const;

// ── Trust levels ──

export const TrustLevelSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export type TrustLevel = z.infer<typeof TrustLevelSchema>;

export const TRUST_LABELS: Record<TrustLevel, string> = {
  1: "Anonymous",
  2: "Authenticated",
  3: "Premium",
  4: "VIP",
} as const;

export const TRUST_CEILINGS: Record<TrustLevel, number> = {
  1: 0.1,
  2: 0.4,
  3: 0.65,
  4: 0.85,
} as const;

// ── Policy decision ──

export const PolicyDecisionKindSchema = z.enum(["allow", "deny", "escalate"]);
export type PolicyDecisionKind = z.infer<typeof PolicyDecisionKindSchema>;

export const PolicyInputSchema = z.object({
  confidence: z.number().min(0).max(1),
  riskScore: z.number().min(0).max(1),
  sentiment: SentimentSchema,
  trustLevel: TrustLevelSchema,
});
export type PolicyInput = z.infer<typeof PolicyInputSchema>;

export const PolicyDecisionSchema = z.object({
  decision: PolicyDecisionKindSchema,
  reason: z.string(),
  effectiveThreshold: z.number(),
  confidence: z.number(),
  riskScore: z.number(),
});
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
