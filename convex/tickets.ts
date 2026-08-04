import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const open = query({
  handler: async (ctx) => {
    const tickets = await ctx.db.query("tickets").order("desc").take(100);
    return tickets.filter((ticket) =>
      ticket.status === "open" || ticket.status === "in_progress" || ticket.status === "escalated"
    );
  },
});

export const create = mutation({
  args: {
    customerId: v.id("customers"),
    conversationId: v.optional(v.id("conversations")),
    subject: v.string(),
    description: v.string(),
    priority: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("urgent")
    ),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("tickets", {
      ...args,
      status: "open",
      createdAt: Date.now(),
    });
    return { ticketId: id, status: "open" as const };
  },
});

export const escalate = mutation({
  args: {
    id: v.id("tickets"),
    customerId: v.string(),
    reason: v.optional(v.string()),
    urgency: v.optional(v.union(v.literal("high"), v.literal("low"))),
  },
  handler: async (ctx, args) => {
    const ticket = await ctx.db.get(args.id);
    if (!ticket) throw new Error("Ticket not found");

    const customer = await ctx.db
      .query("customers")
      .withIndex("by_external_id", (q) => q.eq("externalId", args.customerId))
      .first();
    const ownsTicket = customer?._id === ticket.customerId || String(ticket.customerId) === args.customerId;
    if (!ownsTicket) throw new Error("Ticket is outside the verified customer scope");

    await ctx.db.patch(args.id, {
      status: "escalated",
      priority: args.urgency === "high" ? "urgent" : ticket.priority,
    });

    return { escalated: true, assignee: "support-manager" };
  },
});

export const getById = query({
  args: { id: v.id("tickets") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});
