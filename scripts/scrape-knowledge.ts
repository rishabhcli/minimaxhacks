/**
 * scripts/scrape-knowledge.ts
 *
 * Scrapes knowledge base articles using rtrvr.ai API and upserts them
 * into the Convex knowledgeDocuments table for RAG retrieval.
 *
 * Usage:
 *   npx tsx scripts/scrape-knowledge.ts
 *
 * rtrvr.ai API docs: https://docs.rtrvr.ai
 */

import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dotenvDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dotenvDir, "../.env") });

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import crypto from "node:crypto";

// ── Config ──

const RTRVR_API_KEY = process.env.RTRVR_API_KEY;
const CONVEX_URL = process.env.CONVEX_URL;

if (!RTRVR_API_KEY) {
  console.error("Missing RTRVR_API_KEY environment variable");
  process.exit(1);
}
if (!CONVEX_URL) {
  console.error("Missing CONVEX_URL environment variable");
  process.exit(1);
}

const api = anyApi;
const convex = new ConvexHttpClient(CONVEX_URL);

// ── URLs to scrape ──

const KNOWLEDGE_SOURCES = [
  {
    url: "https://example.com/help/return-policy",
    title: "Return Policy",
    category: "policy",
  },
  {
    url: "https://example.com/help/shipping-info",
    title: "Shipping Information",
    category: "shipping",
  },
  {
    url: "https://example.com/help/account-management",
    title: "Account Management",
    category: "account",
  },
  {
    url: "https://example.com/help/order-tracking",
    title: "Order Tracking Guide",
    category: "orders",
  },
  {
    url: "https://example.com/help/refund-process",
    title: "Refund Process",
    category: "refunds",
  },
];

// ── rtrvr.ai scrape ──

interface RtrvrResponse {
  success: boolean;
  data?: {
    content: string;
    title?: string;
    url: string;
  };
  error?: string;
}

async function scrapeUrl(url: string): Promise<string | null> {
  try {
    const resp = await fetch("https://api.rtrvr.ai/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RTRVR_API_KEY}`,
      },
      body: JSON.stringify({
        url,
        format: "text",
        timeout: 30000,
      }),
    });

    if (!resp.ok) {
      console.error(`  rtrvr.ai HTTP ${resp.status} for ${url}`);
      return null;
    }

    const result = (await resp.json()) as RtrvrResponse;
    if (!result.success || !result.data?.content) {
      console.error(`  rtrvr.ai error for ${url}: ${result.error ?? "no content"}`);
      return null;
    }

    return result.data.content;
  } catch (err) {
    console.error(`  Failed to scrape ${url}:`, err);
    return null;
  }
}

// ── Chunk text for embedding ──

function chunkText(text: string, maxChunkSize = 1000): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length > maxChunkSize && current.length > 0) {
      chunks.push(current.trim());
      current = "";
    }
    current += para + "\n\n";
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

// ── Content hash for deduplication ──

function contentHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

// ── Upsert to Convex ──

async function upsertDocument(doc: {
  title: string;
  url: string;
  category: string;
  content: string;
  contentHash: string;
}): Promise<void> {
  try {
    await convex.mutation(api.knowledgeDocuments.upsert, {
      title: doc.title,
      url: doc.url,
      category: doc.category,
      content: doc.content,
      contentHash: doc.contentHash,
    });
  } catch {
    // If upsert mutation doesn't exist, fall back to insert
    await convex.mutation(api.knowledgeDocuments.insert, {
      title: doc.title,
      url: doc.url,
      category: doc.category,
      content: doc.content,
      contentHash: doc.contentHash,
    });
  }
}

// ── Main ──

async function main(): Promise<void> {
  console.log("ShieldDesk AI — Knowledge Scraper");
  console.log("==================================\n");

  let scraped = 0;
  let chunks = 0;

  for (const source of KNOWLEDGE_SOURCES) {
    console.log(`Scraping: ${source.title} (${source.url})`);
    const content = await scrapeUrl(source.url);

    if (!content) {
      console.log("  Skipped (no content)\n");
      continue;
    }

    scraped++;
    const textChunks = chunkText(content);
    console.log(`  Got ${content.length} chars → ${textChunks.length} chunk(s)`);

    for (let i = 0; i < textChunks.length; i++) {
      const chunk = textChunks[i]!;
      const hash = contentHash(chunk);
      const title = textChunks.length > 1
        ? `${source.title} (Part ${i + 1}/${textChunks.length})`
        : source.title;

      await upsertDocument({
        title,
        url: source.url,
        category: source.category,
        content: chunk,
        contentHash: hash,
      });
      chunks++;
    }

    console.log(`  Upserted ${textChunks.length} chunk(s)\n`);
  }

  console.log("==================================");
  console.log(`Done: ${scraped}/${KNOWLEDGE_SOURCES.length} sources scraped, ${chunks} chunks upserted`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
