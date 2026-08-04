import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.CONVEX_URL = process.env.CONVEX_URL ?? "https://example.invalid";
process.env.MINIMAX_API_KEY = process.env.MINIMAX_API_KEY ?? "test-minimax";
process.env.MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN ?? "test-mcp-token";
process.env.PLIVO_AUTH_ID = "test-account";
process.env.PLIVO_AUTH_TOKEN = "test-token";
process.env.PLIVO_PHONE_NUMBER = "+15550000000";

const { sendPostCallSummary } = await import("../src/plivo/sms.js");

describe("Plivo post-call SMS", () => {
  it("sends a bounded summary with Basic auth and no retry", async () => {
    let calls = 0;
    let requestUrl = "";
    let requestInit: RequestInit | undefined;

    await sendPostCallSummary({
      to: "+15551234567",
      summary: "The order was delayed and a support ticket was opened.",
      fetchImpl: async (url, init) => {
        calls += 1;
        requestUrl = String(url);
        requestInit = init;
        return new Response("{}", { status: 202 });
      },
    });

    assert.equal(calls, 1);
    assert.equal(requestUrl, "https://api.plivo.com/v1/Account/test-account/Message/");
    assert.equal(requestInit?.method, "POST");
    assert.equal(requestInit?.headers && new Headers(requestInit.headers).get("Authorization"), `Basic ${Buffer.from("test-account:test-token").toString("base64")}`);
    const body = JSON.parse(String(requestInit?.body));
    assert.equal(body.src, "+15550000000");
    assert.equal(body.dst, "+15551234567");
    assert.match(body.text, /^ShieldDesk call summary:/);
  });

  it("rejects non-E.164 destinations before calling Plivo", async () => {
    let called = false;
    await assert.rejects(
      sendPostCallSummary({
        to: "555-123-4567",
        summary: "A summary",
        fetchImpl: async () => {
          called = true;
          return new Response("{}", { status: 202 });
        },
      }),
      /E\.164/,
    );
    assert.equal(called, false);
  });
});
