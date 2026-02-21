import { action, query, mutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
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

/** Insert a document with its embedding vector pre-computed */
export const insertWithEmbedding = mutation({
  args: {
    title: v.string(),
    sourceUrl: v.string(),
    content: v.string(),
    contentHash: v.string(),
    chunkIndex: v.number(),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("knowledgeDocuments")
      .withIndex("by_content_hash", (q) => q.eq("contentHash", args.contentHash))
      .first();
    if (existing) return existing._id;

    return await ctx.db.insert("knowledgeDocuments", {
      title: args.title,
      sourceUrl: args.sourceUrl,
      content: args.content,
      contentHash: args.contentHash,
      chunkIndex: args.chunkIndex,
      embedding: args.embedding,
      scrapedAt: Date.now(),
    });
  },
});

/** Vector search using pre-computed embedding */
export const vectorSearch = action({
  args: {
    embedding: v.array(v.float64()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Array<{
    _id: string;
    title: string;
    content: string;
    sourceUrl: string;
    _score: number;
  }>> => {
    const results = await ctx.vectorSearch("knowledgeDocuments", "by_embedding", {
      vector: args.embedding,
      limit: args.limit ?? 5,
    });

    // Fetch full documents for each result
    const docs: Array<{ _id: string; title: string; content: string; sourceUrl: string; _score: number } | null> = await Promise.all(
      results.map(async (r): Promise<{ _id: string; title: string; content: string; sourceUrl: string; _score: number } | null> => {
        const doc: any = await ctx.runQuery(
          internal.knowledgeDocuments.getByIdInternal,
          { id: r._id }
        );
        return doc ? { _id: doc._id, title: doc.title, content: doc.content, sourceUrl: doc.sourceUrl, _score: r._score } : null;
      })
    );

    return docs.filter((d): d is NonNullable<typeof d> => d !== null);
  },
});

/** Get a single document by ID (used internally by vectorSearch action) */
export const getByIdInternal = internalQuery({
  args: { id: v.id("knowledgeDocuments") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
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
