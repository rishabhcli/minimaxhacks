import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const byConversation = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("transcripts")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .order("asc")
      .take(500);
  },
});

export const add = mutation({
  args: {
    conversationId: v.id("conversations"),
    speaker: v.union(v.literal("customer"), v.literal("agent")),
    isFinal: v.boolean(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("transcripts", {
      ...args,
      ts: Date.now(),
    });
  },
});
