import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ── Identity + trust configuration ──
  customers: defineTable({
    email: v.string(),
    phoneE164: v.optional(v.string()),
    displayName: v.string(),
    trustLevel: v.union(
      v.literal(1),
      v.literal(2),
      v.literal(3),
      v.literal(4)
    ),
    tier: v.union(v.literal("free"), v.literal("pro"), v.literal("enterprise")),
    metadata: v.optional(v.any()),
  })
    .index("by_phone", ["phoneE164"])
    .index("by_email", ["email"]),

  // ── Order records (demo seed data) ──
  orders: defineTable({
    customerId: v.id("customers"),
    orderNumber: v.string(),
    status: v.union(
      v.literal("processing"),
      v.literal("shipped"),
      v.literal("delivered"),
      v.literal("cancelled"),
      v.literal("refunded")
    ),
    items: v.array(
      v.object({
        name: v.string(),
        quantity: v.number(),
        priceUsd: v.number(),
      })
    ),
    totalUsd: v.number(),
    placedAt: v.number(),
    shippedAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
  })
    .index("by_order_number", ["orderNumber"])
    .index("by_customer", ["customerId"]),

  // ── Support tickets ──
  tickets: defineTable({
    customerId: v.id("customers"),
    conversationId: v.optional(v.id("conversations")),
    subject: v.string(),
    description: v.string(),
    priority: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("urgent")
    ),
    status: v.union(
      v.literal("open"),
      v.literal("in_progress"),
      v.literal("waiting_customer"),
      v.literal("escalated"),
      v.literal("resolved"),
      v.literal("closed")
    ),
    assignee: v.optional(v.string()),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_customer", ["customerId"])
    .index("by_status", ["status"]),

  // ── Voice session records ──
  conversations: defineTable({
    channelType: v.union(v.literal("vapi_web"), v.literal("plivo_phone")),
    channelSessionId: v.string(),
    customerId: v.optional(v.id("customers")),
    status: v.union(
      v.literal("active"),
      v.literal("completed"),
      v.literal("failed")
    ),
    trustLevel: v.number(),
    sentimentScore: v.optional(v.string()),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    summary: v.optional(v.string()),
  }).index("by_channel_session", ["channelSessionId"]),

  // ── ASR/conversation transcript output ──
  transcripts: defineTable({
    conversationId: v.id("conversations"),
    speaker: v.union(v.literal("customer"), v.literal("agent")),
    isFinal: v.boolean(),
    text: v.string(),
    ts: v.number(),
  }).index("by_conversation", ["conversationId"]),

  // ── Audit trail for every tool call attempt ──
  agentActions: defineTable({
    conversationId: v.optional(v.id("conversations")),
    customerId: v.optional(v.id("customers")),
    toolName: v.string(),
    toolArgs: v.any(),
    status: v.union(
      v.literal("planned"),
      v.literal("policy_checking"),
      v.literal("executing"),
      v.literal("executed"),
      v.literal("blocked"),
      v.literal("escalated"),
      v.literal("failed")
    ),
    confidence: v.optional(v.number()),
    riskScore: v.optional(v.number()),
    effectiveThreshold: v.optional(v.number()),
    sentimentAtTime: v.optional(v.string()),
    policyDecision: v.optional(
      v.union(
        v.literal("allow"),
        v.literal("deny"),
        v.literal("escalate")
      )
    ),
    policyReason: v.optional(v.string()),
    armoriqTokenId: v.optional(v.string()),
    armoriqPlanHash: v.optional(v.string()),
    armoriqVerified: v.optional(v.boolean()),
    result: v.optional(v.any()),
    errorMessage: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    ts: v.number(),
    idempotencyKey: v.string(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_idempotency_key", ["idempotencyKey"]),

  // ── Timeline entries for dashboard ──
  conversationEvents: defineTable({
    conversationId: v.id("conversations"),
    kind: v.union(
      v.literal("message"),
      v.literal("tool_called"),
      v.literal("tool_blocked"),
      v.literal("tool_escalated"),
      v.literal("sentiment_changed"),
      v.literal("trust_resolved"),
      v.literal("summary_generated")
    ),
    actorKind: v.union(
      v.literal("customer"),
      v.literal("agent"),
      v.literal("system")
    ),
    payload: v.any(),
    ts: v.number(),
  }).index("by_conversation", ["conversationId"]),

  // ── RAG knowledge base ──
  knowledgeDocuments: defineTable({
    sourceUrl: v.string(),
    title: v.string(),
    content: v.string(),
    contentHash: v.string(),
    chunkIndex: v.number(),
    embedding: v.array(v.float64()),
    scrapedAt: v.number(),
  })
    .index("by_content_hash", ["contentHash"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["sourceUrl"],
    }),
});
