import { anyApi } from "convex/server";
import { config } from "../config.js";
import { convex } from "../convex-client.js";
import { fetchWithProviderPolicy } from "../provider-http.js";

const api = anyApi;

export interface KnowledgeResult {
  title: string;
  content: string;
  sourceUrl: string;
  score: number;
}

/** Retrieve grounded context with MiniMax embo-01 and Convex vector search. */
export async function searchKnowledge(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KnowledgeResult[]> {
  // Route tests and local unit runs use an intentionally non-routable Convex URL.
  if (config.CONVEX_URL.endsWith("example.invalid")) return [];

  const response = await fetchWithProviderPolicy(
    `${config.MINIMAX_BASE_URL}/embeddings`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.MINIMAX_API_KEY}`,
      },
      body: JSON.stringify({
        model: "embo-01",
        input: [query],
        type: "query",
      }),
    },
    { fetchImpl, timeoutMs: Math.min(config.PROVIDER_TIMEOUT_MS, 4_000), maxAttempts: 2 },
  );

  if (!response.ok) {
    throw new Error(`MiniMax embeddings returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const embedding = payload.data?.[0]?.embedding;
  if (!embedding || embedding.length !== 1536) {
    throw new Error("MiniMax returned an invalid embo-01 embedding");
  }

  const results = await convex.action(api.knowledgeDocuments.vectorSearch, {
    embedding,
    limit: 4,
  }) as Array<{
    title: string;
    content: string;
    sourceUrl: string;
    _score: number;
  }>;

  return results.map((result) => ({
    title: result.title,
    content: result.content,
    sourceUrl: result.sourceUrl,
    score: result._score,
  }));
}
