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

export const create = mutation({
  args: {
    orderNumber: v.string(),
    customerId: v.string(),
    status: v.string(),
    items: v.array(v.object({
      productName: v.string(),
      quantity: v.number(),
      unitPrice: v.number(),
    })),
    totalAmount: v.number(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    // Map seed data format to schema format
    const items = args.items.map((i) => ({
      name: i.productName,
      quantity: i.quantity,
      priceUsd: i.unitPrice,
    }));

    // Find customer by metadata.externalId
    const customers = await ctx.db.query("customers").collect();
    const customer = customers.find(
      (c) => (c.metadata as { externalId?: string })?.externalId === args.customerId
    );

    return await ctx.db.insert("orders", {
      orderNumber: args.orderNumber,
      customerId: customer?._id ?? ("" as any),
      status: args.status as "processing" | "shipped" | "delivered" | "cancelled" | "refunded",
      items,
      totalUsd: args.totalAmount,
      placedAt: args.createdAt,
    });
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
