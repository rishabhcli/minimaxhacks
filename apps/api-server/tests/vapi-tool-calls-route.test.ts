import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { toolCallsRouter } from "../src/vapi/tool-calls.js";

let server: ReturnType<typeof createServer>;
let baseUrl = "";

before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/vapi", toolCallsRouter);
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

describe("VAPI webhook fail-open behavior", () => {
  it("acknowledges payloads without message type", async () => {
    const res = await fetch(`${baseUrl}/vapi/tool-calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: { foo: "bar" } }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  });

  it("acknowledges non-tool events without requiring tool schema", async () => {
    const res = await fetch(`${baseUrl}/vapi/tool-calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: { type: "speech-update" } }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  });

  it("returns empty tool results for malformed tool-calls payload", async () => {
    const res = await fetch(`${baseUrl}/vapi/tool-calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: { type: "tool-calls" } }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.results));
    assert.equal(body.results.length, 0);
  });
});
