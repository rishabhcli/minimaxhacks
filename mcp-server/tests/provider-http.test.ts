import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchWithProviderPolicy } from "../src/provider-http.js";

describe("MCP provider request policy", () => {
  it("retries transient responses", async () => {
    let attempts = 0;
    const response = await fetchWithProviderPolicy(
      "https://provider.test/embeddings",
      { method: "POST" },
      {
        timeoutMs: 100,
        maxAttempts: 2,
        fetchImpl: async () => {
          attempts += 1;
          return attempts === 1 ? new Response("busy", { status: 503 }) : new Response("ok");
        },
        sleep: async () => undefined,
      },
    );

    assert.equal(attempts, 2);
    assert.equal(response.status, 200);
  });

  it("aborts a provider call that exceeds its timeout", async () => {
    await assert.rejects(
      fetchWithProviderPolicy(
        "https://provider.test/hang",
        { method: "POST" },
        {
          timeoutMs: 5,
          fetchImpl: (_url, init) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
            }),
        },
      ),
      /aborted/,
    );
  });
});
