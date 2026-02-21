import express from "express";
import pino from "pino";
import { config } from "./config.js";
import { handleJsonRpc } from "./jsonrpc.js";

const log = pino({ name: "mcp-server" });

const app = express();
app.use(express.json());

// ── Health check ──
app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "shielddesk-mcp", version: "0.1.0" });
});

// ── MCP JSON-RPC endpoint with SSE transport ──
app.post("/mcp", async (req, res) => {
  const acceptsSse = req.headers.accept?.includes("text/event-stream");

  try {
    const result = await handleJsonRpc(req.body, log);

    if (acceptsSse) {
      // SSE response per MCP spec
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.write(`event: message\ndata: ${JSON.stringify(result)}\n\n`);
      res.end();
    } else {
      // Plain JSON fallback (also valid per MCP spec)
      res.json(result);
    }
  } catch (err) {
    log.error({ err }, "Unhandled error in MCP handler");
    const errorResponse = {
      jsonrpc: "2.0" as const,
      id: null,
      error: { code: -32603, message: "Internal error" },
    };
    res.status(500).json(errorResponse);
  }
});

// ── ArmorIQ-compatible invoke endpoint ──
// Accepts { action/tool, params/arguments } and dispatches to tools/call.
app.post("/invoke", async (req, res) => {
  const action =
    typeof req.body?.action === "string"
      ? req.body.action
      : typeof req.body?.tool === "string"
        ? req.body.tool
        : null;
  const args =
    typeof req.body?.params === "object" && req.body?.params !== null
      ? req.body.params
      : typeof req.body?.arguments === "object" && req.body?.arguments !== null
        ? req.body.arguments
        : {};

  if (!action) {
    res.status(400).json({ error: { code: -32602, message: "Missing action" } });
    return;
  }

  try {
    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: {
          name: action,
          arguments: args,
        },
      },
      log
    );
    res.json(result);
  } catch (err) {
    log.error({ err, action }, "Unhandled error in invoke endpoint");
    res
      .status(500)
      .json({ error: { code: -32603, message: "Internal invoke error" } });
  }
});

// ── Start server ──
const port = config.MCP_PORT;
app.listen(port, () => {
  log.info({ port }, "MCP server listening");
});
