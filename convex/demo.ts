import { mutation } from "./_generated/server";
import { v } from "convex/values";

async function clearTable(ctx: any, table: string): Promise<number> {
  const rows = await ctx.db.query(table).collect();
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
  return rows.length;
}

/**
 * Clear mutable support/demo state before a local demonstration.
 * The deployment must provide DEMO_RESET_TOKEN; there is deliberately no fallback token.
 */
export const reset = mutation({
  args: { resetToken: v.string() },
  handler: async (ctx, args) => {
    const expectedToken = process.env.DEMO_RESET_TOKEN;
    if (!expectedToken || args.resetToken !== expectedToken) {
      throw new Error("Demo reset is not authorized");
    }

    return {
      conversations: await clearTable(ctx, "conversations"),
      transcripts: await clearTable(ctx, "transcripts"),
      agentActions: await clearTable(ctx, "agentActions"),
      conversationEvents: await clearTable(ctx, "conversationEvents"),
      tickets: await clearTable(ctx, "tickets"),
      orders: await clearTable(ctx, "orders"),
      customers: await clearTable(ctx, "customers"),
    };
  },
});
