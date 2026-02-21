import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { plivoAnswerRouter } from "../src/plivo/answer.js";
import { config } from "../src/config.js";
import { computePlivoSignatureV2 } from "../src/plivo/signature.js";

let server: ReturnType<typeof createServer>;
let baseUrl = "";

before(async () => {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use("/plivo", plivoAnswerRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function signedHeaders(path: string): Record<string, string> {
  const nonce = `${Date.now()}`;
  const signedUrl = `${config.PUBLIC_URL.replace(/\/$/, "")}${path}`;
  const signature = computePlivoSignatureV2(
    config.PLIVO_AUTH_TOKEN,
    signedUrl,
    nonce
  );
  return {
    "x-plivo-signature-v2": signature,
    "x-plivo-signature-v2-nonce": nonce,
  };
}

describe("Plivo route signature enforcement", () => {
  it("rejects /plivo/answer with invalid signature", async () => {
    if (!config.PLIVO_AUTH_TOKEN) return;

    const res = await fetch(
      `${baseUrl}/plivo/answer?CallUUID=abc&From=%2B15550000001&To=%2B15550000002`,
      {
        method: "POST",
        headers: {
          "x-plivo-signature-v2": "invalid",
          "x-plivo-signature-v2-nonce": "1",
        },
      }
    );

    assert.equal(res.status, 403);
  });

  it("accepts /plivo/answer with valid signature", async () => {
    if (!config.PLIVO_AUTH_TOKEN) return;

    const path =
      "/plivo/answer?CallUUID=abc&From=%2B15550000001&To=%2B15550000002";
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: signedHeaders(path),
    });

    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(body.includes("<Stream"));
    assert.ok(body.includes("audio/x-mulaw;rate=8000"));
  });

  it("rejects /plivo/status with missing signature", async () => {
    if (!config.PLIVO_AUTH_TOKEN) return;

    const res = await fetch(`${baseUrl}/plivo/status?CallUUID=abc`, {
      method: "POST",
    });

    assert.equal(res.status, 403);
  });
});

