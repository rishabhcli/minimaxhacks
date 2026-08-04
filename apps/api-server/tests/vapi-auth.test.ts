import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";

process.env.PORT = process.env.PORT ?? "3000";
process.env.CONVEX_URL = process.env.CONVEX_URL ?? "https://example.invalid";
process.env.MINIMAX_API_KEY = process.env.MINIMAX_API_KEY ?? "test-minimax";
process.env.MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN ?? "test-mcp-token";
process.env.PUBLIC_URL = process.env.PUBLIC_URL ?? "http://127.0.0.1:3100";
process.env.VAPI_WEBHOOK_SECRET = "test-vapi-secret";
process.env.PLIVO_AUTH_TOKEN = process.env.PLIVO_AUTH_TOKEN ?? "test-plivo-token";

const { createApiApp } = await import("../src/app.js");

let server: Server;
let baseUrl = "";

before(async () => {
  server = createServer(createApiApp());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve test server address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

describe("Vapi route authentication", () => {
  it("returns a traceable request id from health", async () => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { "X-Request-Id": "health-check.1" },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-request-id"), "health-check.1");
    const body = (await response.json()) as {
      requestId?: string;
      readiness?: string;
      degraded?: string[];
      configuration?: { vapiWebhookAuth?: boolean; speechmatics?: boolean };
    };
    assert.equal(body.requestId, "health-check.1");
    assert.equal(body.configuration?.vapiWebhookAuth, true);
    assert.equal(body.configuration?.speechmatics, false);
    assert.equal(body.readiness, "degraded");
    assert.ok(body.degraded?.includes("speechmatics"));
  });

  it("rejects unauthenticated tool-call requests when a webhook secret is configured", async () => {
    const response = await fetch(`${baseUrl}/vapi/tool-calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          type: "tool-calls",
          toolCallList: [],
        },
      }),
    });

    assert.equal(response.status, 401);
    const body = (await response.json()) as { error?: { message?: string } };
    assert.equal(body.error?.message, "Unauthorized Vapi request");
  });

  it("accepts authenticated legacy X-Vapi-Secret requests", async () => {
    const response = await fetch(`${baseUrl}/vapi/tool-calls`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Vapi-Secret": "test-vapi-secret",
      },
      body: JSON.stringify({
        message: {
          type: "status-update",
          metadata: {},
        },
      }),
    });

    assert.equal(response.status, 200);
  });

  it("rejects bearer tokens with extra fields", async () => {
    const response = await fetch(`${baseUrl}/vapi/tool-calls`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-vapi-secret extra",
      },
      body: JSON.stringify({
        message: {
          type: "status-update",
          metadata: {},
        },
      }),
    });

    assert.equal(response.status, 401);
  });
});
