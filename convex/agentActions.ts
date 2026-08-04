import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

function compactDefined<T extends Record<string, unknown>>(fields: T): T {
  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) updates[key] = value;
  }
  return updates as T;
}

export const byConversation = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentActions")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .order("desc")
      .take(100);
  },
});

/** Recent decisions for the operations overview. */
export const recent = query({
  handler: async (ctx) => {
    return await ctx.db.query("agentActions").order("desc").take(100);
  },
});

export const byIdempotencyKey = query({
  args: { idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentActions")
      .withIndex("by_idempotency_key", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey)
      )
      .first();
  },
});

/** Atomically reserve a VAPI tool call before any governed execution starts. */
export const claimByIdempotencyKey = mutation({
  args: {
    conversationId: v.optional(v.id("conversations")),
    customerId: v.optional(v.id("customers")),
    toolName: v.string(),
    toolArgs: v.any(),
    confidence: v.optional(v.number()),
    riskScore: v.optional(v.number()),
    sentimentAtTime: v.optional(v.string()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentActions")
      .withIndex("by_idempotency_key", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey)
      )
      .first();

    if (existing) return { claimed: false, existing };

    const actionId = await ctx.db.insert("agentActions", {
      ...args,
      status: "policy_checking",
      ts: Date.now(),
    });
    return { claimed: true, actionId };
  },
});

export const log = mutation({
  args: {
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
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentActions", {
      ...args,
      ts: Date.now(),
    });
  },
});

export const upsertByIdempotencyKey = mutation({
  args: {
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
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentActions")
      .withIndex("by_idempotency_key", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey)
      )
      .first();

    if (existing) {
      await ctx.db.patch(
        existing._id,
        compactDefined({
          ...args,
          ts: Date.now(),
        })
      );
      return existing._id;
    }

    return await ctx.db.insert("agentActions", {
      ...args,
      ts: Date.now(),
    });
  },
});
