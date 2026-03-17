import express from "express";
import pino from "pino";
import { config } from "./config.js";
import { handleJsonRpc } from "./jsonrpc.js";

const log = pino({ name: "mcp-server" });

const app = express();
app.use(express.json());

function isAuthorizedRequest(req: express.Request): boolean {
  const authHeader = req.headers.authorization;
  if (!authHeader) return false;

  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer") return false;

  return token === config.MCP_AUTH_TOKEN;
}

// ── Health check ──
app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "shielddesk-mcp", version: "0.1.0" });
});

// ── MCP JSON-RPC endpoint with SSE transport ──
app.post("/mcp", async (req, res) => {
  if (!isAuthorizedRequest(req)) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="shielddesk-mcp"');
    return res.status(401).json({
      jsonrpc: "2.0" as const,
      id: null,
      error: { code: -32001, message: "Unauthorized" },
    });
  }

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

// ── Start server ──
const port = config.MCP_PORT;
app.listen(port, () => {
  log.info({ port }, "MCP server listening");
});
