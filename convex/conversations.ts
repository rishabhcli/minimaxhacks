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

export const upsertBySession = mutation({
  args: {
    channelType: v.union(v.literal("vapi_web"), v.literal("plivo_phone")),
    channelSessionId: v.string(),
    trustLevel: v.number(),
    sentimentScore: v.optional(v.string()),
    startedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_channel_session", (q) =>
        q.eq("channelSessionId", args.channelSessionId)
      )
      .first();

    if (existing) {
      const updates: {
        trustLevel?: number;
        sentimentScore?: string;
      } = {};

      if (args.trustLevel !== existing.trustLevel) {
        updates.trustLevel = args.trustLevel;
      }
      if (
        typeof args.sentimentScore === "string" &&
        args.sentimentScore !== existing.sentimentScore
      ) {
        updates.sentimentScore = args.sentimentScore;
      }

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(existing._id, updates);
      }

      return existing._id;
    }

    return await ctx.db.insert("conversations", {
      channelType: args.channelType,
      channelSessionId: args.channelSessionId,
      status: "active",
      trustLevel: args.trustLevel,
      sentimentScore: args.sentimentScore,
      startedAt: args.startedAt ?? Date.now(),
    });
  },
});

export const finalizeBySession = mutation({
  args: {
    channelType: v.optional(
      v.union(v.literal("vapi_web"), v.literal("plivo_phone"))
    ),
    channelSessionId: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed")),
    trustLevel: v.optional(v.number()),
    sentimentScore: v.optional(v.string()),
    endedAt: v.optional(v.number()),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_channel_session", (q) =>
        q.eq("channelSessionId", args.channelSessionId)
      )
      .first();

    const resolvedEndedAt = args.endedAt ?? Date.now();

    if (!existing) {
      return await ctx.db.insert("conversations", {
        channelType: args.channelType ?? "vapi_web",
        channelSessionId: args.channelSessionId,
        status: args.status,
        trustLevel: args.trustLevel ?? 2,
        sentimentScore: args.sentimentScore,
        startedAt: resolvedEndedAt,
        endedAt: resolvedEndedAt,
        summary: args.summary,
      });
    }

    const updates: {
      status?: "completed" | "failed";
      trustLevel?: number;
      sentimentScore?: string;
      endedAt?: number;
      summary?: string;
    } = {};

    if (
      existing.status === "active" ||
      (existing.status === "completed" && args.status === "failed")
    ) {
      updates.status = args.status;
    }

    if (
      typeof args.trustLevel === "number" &&
      args.trustLevel !== existing.trustLevel
    ) {
      updates.trustLevel = args.trustLevel;
    }

    if (
      typeof args.sentimentScore === "string" &&
      args.sentimentScore !== existing.sentimentScore
    ) {
      updates.sentimentScore = args.sentimentScore;
    }

    if (!existing.endedAt || resolvedEndedAt > existing.endedAt) {
      updates.endedAt = resolvedEndedAt;
    }

    if (typeof args.summary === "string" && args.summary.trim().length > 0) {
      updates.summary = args.summary.trim();
    }

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(existing._id, updates);
    }

    return existing._id;
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
