import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const byConversation = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("conversationEvents")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .order("desc")
      .take(200);
  },
});

export const add = mutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("conversationEvents", {
      ...args,
      ts: Date.now(),
    });
  },
});
