import { z } from "zod";

// ── Convex table field types as Zod schemas ──
// These mirror the Convex schema for use in non-Convex code (API server, MCP server).

export const CustomerTierSchema = z.enum(["free", "pro", "enterprise"]);
export type CustomerTier = z.infer<typeof CustomerTierSchema>;

export const OrderStatusSchema = z.enum([
  "processing",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const OrderItemSchema = z.object({
  name: z.string(),
  quantity: z.number(),
  priceUsd: z.number(),
});
export type OrderItem = z.infer<typeof OrderItemSchema>;

export const TicketPrioritySchema = z.enum([
  "low",
  "medium",
  "high",
  "urgent",
]);
export type TicketPriority = z.infer<typeof TicketPrioritySchema>;

export const TicketStatusSchema = z.enum([
  "open",
  "in_progress",
  "waiting_customer",
  "escalated",
  "resolved",
  "closed",
]);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

export const ChannelTypeSchema = z.enum(["vapi_web", "plivo_phone"]);
export type ChannelType = z.infer<typeof ChannelTypeSchema>;

export const ConversationStatusSchema = z.enum([
  "active",
  "completed",
  "failed",
]);
export type ConversationStatus = z.infer<typeof ConversationStatusSchema>;

export const AgentActionStatusSchema = z.enum([
  "planned",
  "policy_checking",
  "executing",
  "executed",
  "blocked",
  "escalated",
  "failed",
]);
export type AgentActionStatus = z.infer<typeof AgentActionStatusSchema>;

export const ConversationEventKindSchema = z.enum([
  "message",
  "tool_called",
  "tool_blocked",
  "tool_escalated",
  "sentiment_changed",
  "trust_resolved",
  "summary_generated",
]);
export type ConversationEventKind = z.infer<typeof ConversationEventKindSchema>;

export const ActorKindSchema = z.enum(["customer", "agent", "system"]);
export type ActorKind = z.infer<typeof ActorKindSchema>;

export const SpeakerSchema = z.enum(["customer", "agent"]);
export type Speaker = z.infer<typeof SpeakerSchema>;
