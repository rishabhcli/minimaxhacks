import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.APP_ENV = process.env.APP_ENV ?? "test";
process.env.CONVEX_URL = process.env.CONVEX_URL ?? "https://example.invalid";
process.env.MINIMAX_API_KEY = process.env.MINIMAX_API_KEY ?? "test-minimax";
process.env.MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN ?? "test-token";

const { executeToolCall } = await import("../src/tools/handlers.js");

describe("MCP customer scope", () => {
  it("requires verified context before order lookup", async () => {
    await assert.rejects(
      executeToolCall("order.lookup", { orderNumber: "ORD-1234" }),
      /verified customer context/,
    );
  });
});
