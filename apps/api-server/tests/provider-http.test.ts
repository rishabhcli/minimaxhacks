import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchWithProviderPolicy } from "../src/provider-http.js";

describe("provider request policy", () => {
  it("retries a transient provider response when explicitly allowed", async () => {
    let attempts = 0;
    const response = await fetchWithProviderPolicy(
      "https://provider.test/retry",
      { method: "POST" },
      {
        timeoutMs: 100,
        maxAttempts: 2,
        sleep: async () => undefined,
        fetchImpl: async () => {
          attempts += 1;
          return attempts === 1
            ? new Response("busy", { status: 503 })
            : new Response("ok", { status: 200 });
        },
      },
    );

    assert.equal(response.status, 200);
    assert.equal(attempts, 2);
  });

  it("aborts a provider call that exceeds its timeout", async () => {
    await assert.rejects(
      fetchWithProviderPolicy(
        "https://provider.test/hang",
        { method: "POST" },
        {
          timeoutMs: 5,
          maxAttempts: 1,
          fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          }),
        },
      ),
      /aborted/,
    );
  });
});
