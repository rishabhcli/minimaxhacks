import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const insert = mutation({
  args: {
    title: v.string(),
    url: v.string(),
    category: v.string(),
    content: v.string(),
    contentHash: v.string(),
  },
  handler: async (ctx, args) => {
    // Check for existing document with same contentHash
    const existing = await ctx.db
      .query("knowledgeDocuments")
      .withIndex("by_content_hash", (q) => q.eq("contentHash", args.contentHash))
      .first();
    if (existing) return existing._id;

    return await ctx.db.insert("knowledgeDocuments", {
      title: args.title,
      sourceUrl: args.url,
      content: args.content,
      contentHash: args.contentHash,
      chunkIndex: 0,
      embedding: [], // Will be populated by embedding pipeline
      scrapedAt: Date.now(),
    });
  },
});

export const search = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    // Simple text search fallback (vector search requires embeddings)
    const docs = await ctx.db.query("knowledgeDocuments").collect();
    const queryLower = args.query.toLowerCase();
    return docs
      .filter(
        (d) =>
          d.title.toLowerCase().includes(queryLower) ||
          d.content.toLowerCase().includes(queryLower)
      )
      .slice(0, 5);
  },
});
