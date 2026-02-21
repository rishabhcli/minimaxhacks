import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const getById = query({
  args: { id: v.id("customers") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getByPhone = query({
  args: { phoneE164: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("customers")
      .withIndex("by_phone", (q) => q.eq("phoneE164", args.phoneE164))
      .first();
  },
});

export const getByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("customers")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
  },
});

export const create = mutation({
  args: {
    externalId: v.string(),
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    tier: v.string(),
    trustLevel: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("customers", {
      email: args.email,
      phoneE164: args.phone,
      displayName: args.name,
      trustLevel: args.trustLevel as 1 | 2 | 3 | 4,
      tier: args.tier as "free" | "pro" | "enterprise",
      metadata: { externalId: args.externalId },
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("customers"),
    email: v.optional(v.string()),
    displayName: v.optional(v.string()),
    phoneE164: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    const updates: Record<string, string> = {};
    if (fields.email !== undefined) updates.email = fields.email;
    if (fields.displayName !== undefined)
      updates.displayName = fields.displayName;
    if (fields.phoneE164 !== undefined) updates.phoneE164 = fields.phoneE164;
    await ctx.db.patch(id, updates);
    return { updated: true };
  },
});
