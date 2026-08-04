import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

async function customerOwnsOrder(ctx: any, orderCustomerId: string, reference: string): Promise<boolean> {
  const customer = await ctx.db
    .query("customers")
    .withIndex("by_external_id", (q: any) => q.eq("externalId", reference))
    .first();
  return customer?._id === orderCustomerId || String(orderCustomerId) === reference;
}

export const getByNumber = query({
  args: {
    orderNumber: v.string(),
    customerId: v.string(),
  },
  handler: async (ctx, args) => {
    const order = await ctx.db
      .query("orders")
      .withIndex("by_order_number", (q) =>
        q.eq("orderNumber", args.orderNumber)
      )
      .first();

    if (!order) return null;
    return (await customerOwnsOrder(ctx, order.customerId, args.customerId)) ? order : null;
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
    id: v.optional(v.id("orders")),
    orderNumber: v.optional(v.string()),
    customerId: v.string(),
    reason: v.optional(v.string()),
    amountUsd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!args.id && !args.orderNumber) {
      throw new Error("Refund requires an order id or order number");
    }

    const order = args.id
      ? await ctx.db.get(args.id)
      : await ctx.db
          .query("orders")
          .withIndex("by_order_number", (q) =>
            q.eq("orderNumber", args.orderNumber as string)
          )
          .first();
    if (!order) throw new Error("Order not found");

    if (!(await customerOwnsOrder(ctx, order.customerId, args.customerId))) {
      throw new Error("Order is outside the verified customer scope");
    }

    if (order.status === "refunded") {
      return {
        refundId: `ref_${order._id}`,
        status: "already_refunded" as const,
        amountUsd: order.totalUsd,
      };
    }
    if (order.status === "cancelled") {
      throw new Error("Cancelled orders are not eligible for refunds");
    }

    const refundAmount = args.amountUsd ?? order.totalUsd;
    if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
      throw new Error("Refund amount must be greater than zero");
    }
    if (refundAmount > order.totalUsd) {
      throw new Error("Refund amount cannot exceed the order total");
    }
    if (Math.abs(refundAmount - order.totalUsd) > 0.005) {
      throw new Error("Partial refunds are not supported by the current order ledger");
    }

    await ctx.db.patch(order._id, { status: "refunded" });

    return {
      refundId: `ref_${order._id}`,
      status: "processed" as const,
      amountUsd: refundAmount,
      reason: args.reason,
    };
  },
});
