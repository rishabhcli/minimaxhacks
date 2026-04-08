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
    customerExternalId: v.string(),
    status: v.union(
      v.literal("processing"),
      v.literal("shipped"),
      v.literal("delivered"),
      v.literal("cancelled"),
      v.literal("refunded")
    ),
    items: v.array(
      v.object({
        productName: v.string(),
        quantity: v.number(),
        unitPrice: v.number(),
      })
    ),
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

    const customer = await ctx.db
      .query("customers")
      .withIndex("by_external_id", (q) =>
        q.eq("externalId", args.customerExternalId)
      )
      .first();

    if (!customer) {
      throw new Error(
        `Customer not found for externalId ${args.customerExternalId}`
      );
    }

    return await ctx.db.insert("orders", {
      orderNumber: args.orderNumber,
      customerId: customer._id,
      status: args.status,
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
