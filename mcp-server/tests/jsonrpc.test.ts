import { describe, it } from "node:test";
import assert from "node:assert/strict";
import pino from "pino";

process.env.MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN ?? "test-mcp-token";
process.env.CONVEX_URL = process.env.CONVEX_URL ?? "https://example.invalid";
process.env.MINIMAX_API_KEY = process.env.MINIMAX_API_KEY ?? "test-minimax";

const { handleJsonRpc } = await import("../src/jsonrpc.js");

const log = pino({ enabled: false });

describe("MCP JSON-RPC tool context", () => {
  it("accepts lifecycle notifications without returning a response body", async () => {
    const response = await handleJsonRpc(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      log,
    );

    assert.equal(response, null);
  });

  it("passes the verified execution context to the tool handler", async () => {
    let receivedContext: unknown;
    const response = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: "scope-1",
        method: "tools/call",
        params: {
          name: "order.lookup",
          arguments: { orderNumber: "ORD-1234" },
          context: {
            customerId: "customer-doc-1",
            conversationId: "conversation-1",
          },
        },
      },
      log,
      async (_toolName, _args, context) => {
        receivedContext = context;
        return { content: [{ type: "text", text: "scoped" }] };
      },
    );

    assert.deepEqual(receivedContext, {
      customerId: "customer-doc-1",
      conversationId: "conversation-1",
    });
    assert.deepEqual(response, {
      jsonrpc: "2.0",
      id: "scope-1",
      result: { content: [{ type: "text", text: "scoped" }] },
    });
  });

  it("rejects tools/call requests with malformed execution context", async () => {
    const response = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "account.lookup",
          arguments: {},
          context: { customerId: "" },
        },
      },
      log,
      async () => ({ content: [{ type: "text", text: "unexpected" }] }),
    );

    assert.equal(response.jsonrpc, "2.0");
    if (response.jsonrpc === "2.0" && "error" in response) {
      assert.equal(response.error.code, -32602);
    }
  });
});
