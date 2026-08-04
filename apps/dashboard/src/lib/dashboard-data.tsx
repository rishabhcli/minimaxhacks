"use client";

import { useQuery } from "convex/react";
import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { ConvexProvider } from "convex/react";
import { api } from "@/lib/api";
import { convex, isConvexConfigured } from "@/lib/convex";

export type ChannelType = "vapi_web" | "plivo_phone";
export type ConversationStatus = "active" | "completed" | "failed";
export type Sentiment = "frustrated" | "neutral" | "satisfied" | "calm";
export type PolicyDecision = "allow" | "deny" | "escalate";

export interface DashboardCustomer {
  _id: string;
  externalId?: string;
  displayName: string;
  email: string;
  tier: "free" | "pro" | "enterprise";
  trustLevel: 1 | 2 | 3 | 4;
}

export interface DashboardConversation {
  _id: string;
  channelType: ChannelType;
  channelSessionId: string;
  customerId?: string;
  customer?: DashboardCustomer;
  status: ConversationStatus;
  trustLevel: 1 | 2 | 3 | 4;
  sentimentScore?: Sentiment;
  startedAt: number;
  endedAt?: number;
  summary?: string;
}

export interface DashboardAction {
  _id: string;
  conversationId?: string;
  customerId?: string;
  toolName: string;
  toolArgs?: Record<string, unknown>;
  status: "planned" | "policy_checking" | "executing" | "executed" | "blocked" | "escalated" | "failed";
  confidence?: number;
  riskScore?: number;
  effectiveThreshold?: number;
  sentimentAtTime?: string;
  policyDecision?: PolicyDecision;
  policyReason?: string;
  armoriqVerified?: boolean;
  armoriqTokenId?: string;
  armoriqPlanHash?: string;
  result?: unknown;
  errorMessage?: string;
  durationMs?: number;
  ts: number;
}

export interface DashboardEvent {
  _id: string;
  conversationId: string;
  kind: string;
  actorKind: "customer" | "agent" | "system";
  payload: Record<string, unknown>;
  ts: number;
}

export interface DashboardTranscript {
  _id: string;
  conversationId: string;
  speaker: "customer" | "agent";
  isFinal: boolean;
  text: string;
  ts: number;
}

export interface DashboardTicket {
  _id: string;
  customerId: string;
  conversationId?: string;
  subject: string;
  description: string;
  priority: "low" | "medium" | "high" | "urgent";
  status: "open" | "in_progress" | "waiting_customer" | "escalated" | "resolved" | "closed";
  assignee?: string;
  createdAt: number;
}

export interface DashboardData {
  dataSource: "live" | "preview";
  isLoading: boolean;
  conversations: DashboardConversation[];
  actions: DashboardAction[];
  customers: DashboardCustomer[];
  tickets: DashboardTicket[];
}

const DashboardDataContext = createContext<DashboardData | null>(null);

const PREVIEW_NOW = Date.parse("2026-08-04T17:39:00.000Z");

const PREVIEW_CUSTOMERS: DashboardCustomer[] = [
  {
    _id: "preview-customer-alice",
    externalId: "cust_auth_01",
    displayName: "Alice Johnson",
    email: "alice@example.com",
    tier: "pro",
    trustLevel: 2,
  },
  {
    _id: "preview-customer-bob",
    externalId: "cust_premium_01",
    displayName: "Bob Smith",
    email: "bob@premium.com",
    tier: "pro",
    trustLevel: 3,
  },
  {
    _id: "preview-customer-carol",
    externalId: "cust_vip_01",
    displayName: "Carol Williams",
    email: "carol@vip.com",
    tier: "enterprise",
    trustLevel: 4,
  },
];

const PREVIEW_CONVERSATIONS: DashboardConversation[] = [
  {
    _id: "preview-conversation-alice",
    channelType: "vapi_web",
    channelSessionId: "call_preview_alice",
    customerId: "preview-customer-alice",
    customer: PREVIEW_CUSTOMERS[0],
    status: "active",
    trustLevel: 2,
    sentimentScore: "frustrated",
    startedAt: PREVIEW_NOW - 4 * 60 * 1000,
    summary: "Order ORD-9999 is delayed. Refund request needs manager review.",
  },
  {
    _id: "preview-conversation-carol",
    channelType: "plivo_phone",
    channelSessionId: "call_preview_carol",
    customerId: "preview-customer-carol",
    customer: PREVIEW_CUSTOMERS[2],
    status: "completed",
    trustLevel: 4,
    sentimentScore: "satisfied",
    startedAt: PREVIEW_NOW - 26 * 60 * 1000,
    endedAt: PREVIEW_NOW - 19 * 60 * 1000,
    summary: "Refund for ORD-5678 marked approved in a preview audit record.",
  },
  {
    _id: "preview-conversation-bob",
    channelType: "vapi_web",
    channelSessionId: "call_preview_bob",
    customerId: "preview-customer-bob",
    customer: PREVIEW_CUSTOMERS[1],
    status: "completed",
    trustLevel: 3,
    sentimentScore: "neutral",
    startedAt: PREVIEW_NOW - 52 * 60 * 1000,
    endedAt: PREVIEW_NOW - 47 * 60 * 1000,
    summary: "Email change was held for confirmation before account mutation.",
  },
];

const PREVIEW_ACTIONS: DashboardAction[] = [
  {
    _id: "preview-action-refund",
    conversationId: "preview-conversation-alice",
    customerId: "preview-customer-alice",
    toolName: "order.refund",
    toolArgs: { orderId: "ORD-9999" },
    status: "escalated",
    confidence: 0.88,
    riskScore: 0.6,
    effectiveThreshold: 0.56,
    sentimentAtTime: "frustrated",
    policyDecision: "escalate",
    policyReason: "Risk 0.6 exceeds the authenticated customer's 0.56 threshold.",
    armoriqVerified: false,
    durationMs: 38,
    ts: PREVIEW_NOW - 2 * 60 * 1000,
  },
  {
    _id: "preview-action-lookup",
    conversationId: "preview-conversation-alice",
    customerId: "preview-customer-alice",
    toolName: "order.lookup",
    toolArgs: { orderNumber: "ORD-9999" },
    status: "executed",
    confidence: 0.96,
    riskScore: 0.05,
    effectiveThreshold: 0.56,
    sentimentAtTime: "frustrated",
    policyDecision: "allow",
    policyReason: "Low-risk lookup is below the active policy threshold.",
    armoriqVerified: true,
    armoriqTokenId: "tok_preview_8f2a",
    armoriqPlanHash: "sha256:8f2a...c19e",
    result: { status: "shipped", tracking: "SD-4418" },
    durationMs: 214,
    ts: PREVIEW_NOW - 3 * 60 * 1000,
  },
  {
    _id: "preview-action-vip-refund",
    conversationId: "preview-conversation-carol",
    customerId: "preview-customer-carol",
    toolName: "order.refund",
    toolArgs: { orderId: "ORD-5678" },
    status: "executed",
    confidence: 0.94,
    riskScore: 0.6,
    effectiveThreshold: 0.765,
    sentimentAtTime: "satisfied",
    policyDecision: "allow",
    policyReason: "VIP ceiling 0.85 × satisfied multiplier 0.90 clears the risk score.",
    armoriqVerified: true,
    armoriqTokenId: "tok_preview_59b1",
    armoriqPlanHash: "sha256:59b1...7de4",
    result: { status: "processed", amountUsd: 1348.99 },
    durationMs: 684,
    ts: PREVIEW_NOW - 21 * 60 * 1000,
  },
  {
    _id: "preview-action-account",
    conversationId: "preview-conversation-bob",
    customerId: "preview-customer-bob",
    toolName: "account.update",
    toolArgs: { email: "bob+new@example.com" },
    status: "escalated",
    confidence: 0.81,
    riskScore: 0.4,
    effectiveThreshold: 0.65,
    sentimentAtTime: "neutral",
    policyDecision: "escalate",
    policyReason: "Intent confidence is below the 0.85 autonomous-action bar.",
    armoriqVerified: false,
    durationMs: 42,
    ts: PREVIEW_NOW - 49 * 60 * 1000,
  },
];

const PREVIEW_TICKETS: DashboardTicket[] = [
  {
    _id: "preview-ticket-1",
    customerId: "preview-customer-alice",
    conversationId: "preview-conversation-alice",
    subject: "Refund approval for ORD-9999",
    description: "Delayed shipment refund requires support manager approval.",
    priority: "high",
    status: "escalated",
    assignee: "support-manager",
    createdAt: PREVIEW_NOW - 2 * 60 * 1000,
  },
];

function mergeCustomers(
  conversations: Array<Record<string, unknown>> | undefined,
  customers: DashboardCustomer[] | undefined,
): DashboardConversation[] | undefined {
  if (!conversations) return undefined;
  const customerById = new Map((customers ?? []).map((customer) => [customer._id, customer]));
  return conversations.map((conversation) => {
    const customerId = typeof conversation.customerId === "string" ? conversation.customerId : undefined;
    return {
      ...(conversation as unknown as DashboardConversation),
      customerId,
      customer: customerId ? customerById.get(customerId) : undefined,
    };
  });
}

function LiveDashboardDataProvider({ children }: { children: ReactNode }) {
  const conversations = useQuery(api.conversations.list) as Array<Record<string, unknown>> | undefined;
  const actions = useQuery(api.agentActions.recent) as DashboardAction[] | undefined;
  const customers = useQuery(api.customers.list) as DashboardCustomer[] | undefined;
  const tickets = useQuery(api.tickets.open) as DashboardTicket[] | undefined;

  const value = useMemo<DashboardData>(
    () => ({
      dataSource: "live",
      isLoading: conversations === undefined || actions === undefined || customers === undefined || tickets === undefined,
      conversations: mergeCustomers(conversations, customers) ?? [],
      actions: actions ?? [],
      customers: customers ?? [],
      tickets: tickets ?? [],
    }),
    [actions, conversations, customers, tickets],
  );

  return <DashboardDataContext.Provider value={value}>{children}</DashboardDataContext.Provider>;
}

function PreviewDashboardDataProvider({ children }: { children: ReactNode }) {
  const value = useMemo<DashboardData>(
    () => ({
      dataSource: "preview",
      isLoading: false,
      conversations: PREVIEW_CONVERSATIONS,
      actions: PREVIEW_ACTIONS,
      customers: PREVIEW_CUSTOMERS,
      tickets: PREVIEW_TICKETS,
    }),
    [],
  );

  return <DashboardDataContext.Provider value={value}>{children}</DashboardDataContext.Provider>;
}

export function DashboardDataProvider({ children }: { children: ReactNode }) {
  if (isConvexConfigured && convex) {
    return (
      <ConvexProvider client={convex}>
        <LiveDashboardDataProvider>{children}</LiveDashboardDataProvider>
      </ConvexProvider>
    );
  }

  return <PreviewDashboardDataProvider>{children}</PreviewDashboardDataProvider>;
}

export function useDashboardData(): DashboardData {
  const context = useContext(DashboardDataContext);
  if (!context) throw new Error("useDashboardData must be used inside DashboardDataProvider");
  return context;
}

interface ConversationDetailData {
  dataSource: "live" | "preview";
  isLoading: boolean;
  conversation: DashboardConversation | null;
  customer?: DashboardCustomer;
  transcripts: DashboardTranscript[];
  actions: DashboardAction[];
  events: DashboardEvent[];
}

const ConversationDetailContext = createContext<ConversationDetailData | null>(null);

function LiveConversationDetailProvider({ id, children }: { id: string; children: ReactNode }) {
  const conversation = useQuery(api.conversations.getById, { id }) as DashboardConversation | null | undefined;
  const customer = useQuery(
    api.customers.getById,
    conversation?.customerId ? { id: conversation.customerId } : "skip",
  ) as DashboardCustomer | null | undefined;
  const transcripts = useQuery(api.transcripts.byConversation, { conversationId: id }) as DashboardTranscript[] | undefined;
  const actions = useQuery(api.agentActions.byConversation, { conversationId: id }) as DashboardAction[] | undefined;
  const events = useQuery(api.conversationEvents.byConversation, { conversationId: id }) as DashboardEvent[] | undefined;

  const value = useMemo<ConversationDetailData>(
    () => ({
      dataSource: "live",
      isLoading: conversation === undefined || transcripts === undefined || actions === undefined || events === undefined,
      conversation: conversation
        ? {
            ...conversation,
            customer: customer ?? undefined,
          }
        : conversation ?? null,
      customer: customer ?? undefined,
      transcripts: transcripts ?? [],
      actions: actions ?? [],
      events: events ?? [],
    }),
    [actions, conversation, customer, events, transcripts],
  );

  return <ConversationDetailContext.Provider value={value}>{children}</ConversationDetailContext.Provider>;
}

function PreviewConversationDetailProvider({ id, children }: { id: string; children: ReactNode }) {
  const conversation = PREVIEW_CONVERSATIONS.find((item) => item._id === id) ?? null;
  const actions = PREVIEW_ACTIONS.filter((action) => action.conversationId === id);
  const customer = conversation?.customer;
  const transcripts: DashboardTranscript[] = conversation
    ? conversation._id === "preview-conversation-alice"
      ? [
          {
            _id: "preview-transcript-1",
            conversationId: id,
            speaker: "customer",
            isFinal: true,
            text: "My order still has not arrived. I want a refund.",
            ts: PREVIEW_NOW - 4 * 60 * 1000,
          },
          {
            _id: "preview-transcript-2",
            conversationId: id,
            speaker: "agent",
            isFinal: true,
            text: "I found ORD-9999. I can see the delay. I will route the refund for manager review.",
            ts: PREVIEW_NOW - 3 * 60 * 1000,
          },
        ]
      : [
          {
            _id: `preview-transcript-${id}-1`,
            conversationId: id,
            speaker: "customer",
            isFinal: true,
            text: "Can you help me with my order?",
            ts: conversation.startedAt + 30 * 1000,
          },
          {
            _id: `preview-transcript-${id}-2`,
            conversationId: id,
            speaker: "agent",
            isFinal: true,
            text: "I have checked the account and will keep the next step within your policy boundary.",
            ts: conversation.startedAt + 65 * 1000,
          },
        ]
    : [];
  const events: DashboardEvent[] = conversation
    ? [
        {
          _id: `preview-event-${id}-1`,
          conversationId: id,
          kind: "trust_resolved",
          actorKind: "system" as const,
          payload: { trustLevel: conversation.trustLevel },
          ts: conversation.startedAt,
        },
        ...actions.map((action) => ({
          _id: `preview-event-${action._id}`,
          conversationId: id,
          kind: action.policyDecision === "allow" ? "tool_called" : "tool_escalated",
          actorKind: "agent" as const,
          payload: {
            toolName: action.toolName,
            decision: action.policyDecision,
            reason: action.policyReason,
          },
          ts: action.ts,
        })),
      ].sort((a, b) => b.ts - a.ts)
    : [];

  const value: ConversationDetailData = {
    dataSource: "preview",
    isLoading: false,
    conversation,
    customer,
    transcripts,
    actions,
    events,
  };

  return <ConversationDetailContext.Provider value={value}>{children}</ConversationDetailContext.Provider>;
}

export function ConversationDetailProvider({ id, children }: { id: string; children: ReactNode }) {
  const { dataSource } = useDashboardData();
  if (dataSource === "live" && isConvexConfigured && convex) {
    return <LiveConversationDetailProvider id={id}>{children}</LiveConversationDetailProvider>;
  }
  return <PreviewConversationDetailProvider id={id}>{children}</PreviewConversationDetailProvider>;
}

export function useConversationDetailData(): ConversationDetailData {
  const context = useContext(ConversationDetailContext);
  if (!context) throw new Error("useConversationDetailData must be used inside ConversationDetailProvider");
  return context;
}

export const previewNow = PREVIEW_NOW;
