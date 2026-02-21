import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const getByNumber = query({
  args: { orderNumber: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("orders")
      .withIndex("by_order_number", (q) =>
        q.eq("orderNumber", args.orderNumber)
      )
      .first();
  },
});

export const refund = mutation({
  args: {
    id: v.id("orders"),
    reason: v.optional(v.string()),
    amountUsd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.id);
    if (!order) throw new Error("Order not found");

    await ctx.db.patch(args.id, { status: "refunded" });

    const refundAmount = args.amountUsd ?? order.totalUsd;
    return {
      refundId: `ref_${args.id}`,
      status: "processed" as const,
      amountUsd: refundAmount,
    };
  },
});
