import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  handler: async (ctx) => {
    return await ctx.db.query("conversations").order("desc").take(50);
  },
});

export const getById = query({
  args: { id: v.id("conversations") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getBySessionId = query({
  args: { channelSessionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("conversations")
      .withIndex("by_channel_session", (q) =>
        q.eq("channelSessionId", args.channelSessionId)
      )
      .first();
  },
});

export const create = mutation({
  args: {
    channelType: v.union(v.literal("vapi_web"), v.literal("plivo_phone")),
    channelSessionId: v.string(),
    customerId: v.optional(v.id("customers")),
    trustLevel: v.number(),
    sentimentScore: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("conversations", {
      ...args,
      status: "active",
      startedAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("conversations"),
    status: v.optional(
      v.union(
        v.literal("active"),
        v.literal("completed"),
        v.literal("failed")
      )
    ),
    sentimentScore: v.optional(v.string()),
    endedAt: v.optional(v.number()),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    const updates: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(fields)) {
      if (val !== undefined) updates[k] = val;
    }
    await ctx.db.patch(id, updates);
  },
});
