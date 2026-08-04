import { anyApi } from "convex/server";
import type {
  ActorKind,
  AgentActionStatus,
  ChannelType,
  ConversationEventKind,
  PolicyDecisionKind,
  Sentiment,
  Speaker,
  TrustLevel,
} from "@shielddesk/shared";
import { convex } from "./convex-client.js";

const api = anyApi;

interface StoredConversation {
  _id: string;
  sentimentScore?: Sentiment;
}

interface StoredCustomer {
  _id: string;
  trustLevel: TrustLevel;
}

export async function resolveCustomerReference(
  reference?: string,
): Promise<string | undefined> {
  if (!reference) return undefined;

  const customer = (await convex.query(api.customers.getByReference, {
    reference,
  })) as { _id: string } | null;

  return customer?._id;
}

interface EnsureConversationInput {
  channelType: ChannelType;
  channelSessionId: string;
  customerId?: string;
  trustLevel: TrustLevel;
  sentimentScore?: Sentiment;
}

export interface ActionRecordInput {
  conversationId?: string;
  customerId?: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  status: AgentActionStatus;
  confidence?: number;
  riskScore?: number;
  effectiveThreshold?: number;
  sentimentAtTime?: Sentiment;
  policyDecision?: PolicyDecisionKind;
  policyReason?: string;
  armoriqTokenId?: string;
  armoriqPlanHash?: string;
  armoriqVerified?: boolean;
  result?: unknown;
  errorMessage?: string;
  durationMs?: number;
  idempotencyKey: string;
}

export interface ExistingAgentAction {
  status: AgentActionStatus;
  policyDecision?: PolicyDecisionKind;
  policyReason?: string;
  result?: unknown;
  errorMessage?: string;
}

async function getConversationBySessionId(
  channelSessionId: string
): Promise<StoredConversation | null> {
  return (await convex.query(api.conversations.getBySessionId, {
    channelSessionId,
  })) as StoredConversation | null;
}

export async function ensureConversation({
  channelType,
  channelSessionId,
  customerId,
  trustLevel,
  sentimentScore,
}: EnsureConversationInput): Promise<string> {
  const existing = await getConversationBySessionId(channelSessionId);

  if (existing) {
    if (
      sentimentScore !== undefined &&
      sentimentScore !== existing.sentimentScore
    ) {
      await convex.mutation(api.conversations.update, {
        id: existing._id,
        sentimentScore,
      });
    }
    return existing._id;
  }

  const conversationId = (await convex.mutation(api.conversations.create, {
    channelType,
    channelSessionId,
    customerId,
    trustLevel,
    sentimentScore,
  })) as string;

  await convex.mutation(api.conversationEvents.add, {
    conversationId,
    kind: "trust_resolved",
    actorKind: "system",
    payload: {
      channelType,
      trustLevel,
      customerId: customerId ?? null,
    },
  });

  return conversationId;
}

export async function getCustomerByPhone(
  phoneE164: string
): Promise<StoredCustomer | null> {
  return (await convex.query(api.customers.getByPhone, {
    phoneE164,
  })) as StoredCustomer | null;
}

export async function updateConversationSentiment(
  conversationId: string,
  previous: Sentiment,
  current: Sentiment
): Promise<void> {
  if (previous === current) return;

  await convex.mutation(api.conversations.update, {
    id: conversationId,
    sentimentScore: current,
  });

  await convex.mutation(api.conversationEvents.add, {
    conversationId,
    kind: "sentiment_changed",
    actorKind: "system",
    payload: {
      previous,
      current,
    },
  });
}

export async function updateConversationStatus(
  conversationId: string,
  status: "active" | "completed" | "failed",
  summary?: string
): Promise<void> {
  await convex.mutation(api.conversations.update, {
    id: conversationId,
    status,
    endedAt: status === "active" ? undefined : Date.now(),
    summary,
  });
}

export async function recordMessage(
  conversationId: string,
  speaker: Speaker,
  text: string,
  isFinal = true
): Promise<void> {
  if (!text.trim()) return;

  const actorKind: ActorKind = speaker === "customer" ? "customer" : "agent";

  await Promise.all([
    convex.mutation(api.transcripts.add, {
      conversationId,
      speaker,
      isFinal,
      text,
    }),
    convex.mutation(api.conversationEvents.add, {
      conversationId,
      kind: "message",
      actorKind,
      payload: {
        speaker,
        text,
        isFinal,
      },
    }),
  ]);
}

export async function recordConversationEvent(
  conversationId: string,
  kind: ConversationEventKind,
  actorKind: ActorKind,
  payload: Record<string, unknown>
): Promise<void> {
  await convex.mutation(api.conversationEvents.add, {
    conversationId,
    kind,
    actorKind,
    payload,
  });
}

export async function upsertAgentAction(
  input: ActionRecordInput
): Promise<void> {
  await convex.mutation(api.agentActions.upsertByIdempotencyKey, input);
}

export async function claimAgentAction(
  input: ActionRecordInput
): Promise<{ claimed: boolean; existing?: ExistingAgentAction }> {
  return (await convex.mutation(api.agentActions.claimByIdempotencyKey, {
    conversationId: input.conversationId,
    customerId: input.customerId,
    toolName: input.toolName,
    toolArgs: input.toolArgs,
    confidence: input.confidence,
    riskScore: input.riskScore,
    sentimentAtTime: input.sentimentAtTime,
    idempotencyKey: input.idempotencyKey,
  })) as { claimed: boolean; existing?: ExistingAgentAction };
}
