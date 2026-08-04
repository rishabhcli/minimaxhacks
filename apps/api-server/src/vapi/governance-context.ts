import type { Sentiment, TrustLevel } from "@shielddesk/shared";

const VALID_TRUST_LEVELS = new Set<TrustLevel>([1, 2, 3, 4]);
const VALID_SENTIMENTS = new Set<Sentiment>([
  "frustrated",
  "neutral",
  "satisfied",
  "calm",
]);

export interface ResolvedGovernanceContext {
  trustLevel: TrustLevel;
  sentiment: Sentiment;
  confidence: number;
  conversationId?: string;
  customerId?: string;
}

interface ResolveGovernanceContextInput {
  sessionMeta: Record<string, unknown>;
  detectedSentiment: Sentiment;
  allowClientOverrides: boolean;
}

export function resolveGovernanceContext({
  sessionMeta,
  detectedSentiment,
  allowClientOverrides,
}: ResolveGovernanceContextInput): ResolvedGovernanceContext {
  const requestedTrustLevel =
    typeof sessionMeta.trustLevel === "number" &&
    VALID_TRUST_LEVELS.has(sessionMeta.trustLevel as TrustLevel)
      ? (sessionMeta.trustLevel as TrustLevel)
      : undefined;

  const trustLevel =
    allowClientOverrides && requestedTrustLevel !== undefined
      ? requestedTrustLevel
      : 1;

  const requestedSentiment =
    typeof sessionMeta.sentiment === "string" &&
    VALID_SENTIMENTS.has(sessionMeta.sentiment as Sentiment)
      ? (sessionMeta.sentiment as Sentiment)
      : undefined;

  const sentiment =
    detectedSentiment !== "neutral"
      ? detectedSentiment
      : allowClientOverrides && requestedSentiment
        ? requestedSentiment
        : "neutral";

  const requestedConfidence =
    typeof sessionMeta.confidence === "number" &&
    Number.isFinite(sessionMeta.confidence) &&
    sessionMeta.confidence >= 0 &&
    sessionMeta.confidence <= 1
      ? sessionMeta.confidence
      : undefined;

  return {
    trustLevel,
    sentiment,
    confidence:
      allowClientOverrides && requestedConfidence !== undefined
        ? requestedConfidence
        : 0.9,
    conversationId:
      allowClientOverrides && typeof sessionMeta.conversationId === "string"
        ? sessionMeta.conversationId
        : undefined,
    customerId:
      allowClientOverrides && typeof sessionMeta.customerId === "string"
        ? sessionMeta.customerId
        : undefined,
  };
}
