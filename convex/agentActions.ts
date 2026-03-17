import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

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
