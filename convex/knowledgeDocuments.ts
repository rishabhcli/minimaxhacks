import { action, query, mutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const BaseKnowledgeDocumentArgs = {
  title: v.string(),
  url: v.string(),
  category: v.optional(v.string()),
  content: v.string(),
  contentHash: v.string(),
  embedding: v.array(v.float64()),
};

function assertEmbeddingDimension(embedding: number[]): void {
  if (embedding.length !== 1536) {
    throw new Error(`Knowledge embedding must contain 1536 values, received ${embedding.length}`);
  }
}

async function getByContentHash(ctx: any, contentHash: string) {
  return await ctx.db
    .query("knowledgeDocuments")
    .withIndex("by_content_hash", (q) => q.eq("contentHash", contentHash))
    .first();
}

export const insert = mutation({
  args: BaseKnowledgeDocumentArgs,
  handler: async (ctx, args) => {
    assertEmbeddingDimension(args.embedding);
    const existing = await getByContentHash(ctx, args.contentHash);
    if (existing) return existing._id;

    return await ctx.db.insert("knowledgeDocuments", {
      title: args.title,
      category: args.category,
      sourceUrl: args.url,
      content: args.content,
      contentHash: args.contentHash,
      chunkIndex: 0,
      embedding: args.embedding,
      scrapedAt: Date.now(),
    });
  },
});

export const upsert = mutation({
  args: BaseKnowledgeDocumentArgs,
  handler: async (ctx, args) => {
    assertEmbeddingDimension(args.embedding);
    const existing = await getByContentHash(ctx, args.contentHash);
    if (existing) {
      await ctx.db.patch(existing._id, {
        title: args.title,
        category: args.category,
        sourceUrl: args.url,
        content: args.content,
        embedding: args.embedding,
        scrapedAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("knowledgeDocuments", {
      title: args.title,
      category: args.category,
      sourceUrl: args.url,
      content: args.content,
      contentHash: args.contentHash,
      chunkIndex: 0,
      embedding: args.embedding,
      scrapedAt: Date.now(),
    });
  },
});

/** Insert a document with its embedding vector pre-computed */
export const insertWithEmbedding = mutation({
  args: {
    title: v.string(),
    sourceUrl: v.string(),
    category: v.optional(v.string()),
    content: v.string(),
    contentHash: v.string(),
    chunkIndex: v.number(),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, args) => {
    assertEmbeddingDimension(args.embedding);
    const existing = await getByContentHash(ctx, args.contentHash);
    if (existing) {
      await ctx.db.patch(existing._id, {
        title: args.title,
        sourceUrl: args.sourceUrl,
        category: args.category,
        content: args.content,
        chunkIndex: args.chunkIndex,
        embedding: args.embedding,
        scrapedAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("knowledgeDocuments", {
      title: args.title,
      category: args.category,
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
