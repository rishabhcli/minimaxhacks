import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";

process.env.PORT = process.env.PORT ?? "3000";
process.env.CONVEX_URL = process.env.CONVEX_URL ?? "https://example.invalid";
process.env.MINIMAX_API_KEY = process.env.MINIMAX_API_KEY ?? "test-minimax";
process.env.MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN ?? "test-mcp-token";
process.env.PUBLIC_URL = "http://127.0.0.1:3101";
process.env.PLIVO_AUTH_TOKEN = "plivo-auth-token";

const { createApiApp } = await import("../src/app.js");
const { validatePlivoV3Signature } = await import("../src/request-auth.js");

let server: Server;

before(async () => {
  server = createServer(createApiApp());
  server.listen(3101, "127.0.0.1");
  await once(server, "listening");
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

describe("Plivo ingress authentication", () => {
  it("rejects unsigned answer callbacks", async () => {
    const body = new URLSearchParams({
      CallUUID: "call-123",
      From: "+15551111111",
      To: "+15552222222",
    });

    const response = await fetch("http://127.0.0.1:3101/plivo/answer", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    assert.equal(response.status, 403);
  });

  it("validates V3 webhook signatures for POST callbacks", () => {
    const url = "http://127.0.0.1:3101/plivo/answer";
    const nonce = "nonce-123";
    const params = {
      CallUUID: "call-123",
      From: "+15551111111",
      To: "+15552222222",
    };

    const signedPayload =
      url +
      "CallUUIDcall-123" +
      "From+15551111111" +
      "To+15552222222" +
      nonce;

    const signature = crypto
      .createHmac("sha256", "plivo-auth-token")
      .update(signedPayload)
      .digest("base64");

    assert.equal(
      validatePlivoV3Signature({
        method: "POST",
        url,
        nonce,
        signatureHeader: signature,
        authToken: "plivo-auth-token",
        params,
      }),
      true
    );
  });
});
