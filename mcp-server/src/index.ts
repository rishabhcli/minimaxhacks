import express from "express";
import crypto from "node:crypto";
import pino from "pino";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { handleJsonRpc } from "./jsonrpc.js";

const log = pino({ name: "mcp-server" });

const app = express();
app.use((req, res, next) => {
  const supplied = req.header("x-request-id");
  const requestId = supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : crypto.randomUUID();
  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
});
app.use(express.json({ limit: "128kb" }));

app.use("/mcp", rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  limit: config.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      jsonrpc: "2.0" as const,
      id: null,
      error: { code: -32029, message: "Rate limit exceeded", requestId: res.locals.requestId },
    });
  },
}));

function isAuthorizedRequest(req: express.Request): boolean {
  const authHeader = req.headers.authorization;
  if (!authHeader) return false;

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== "bearer") return false;
  const token = parts[1];
  const expected = Buffer.from(config.MCP_AUTH_TOKEN);
  const actual = Buffer.from(token ?? "");

  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// ── Health check ──
app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "shielddesk-mcp", version: "0.1.0", requestId: res.locals.requestId });
});

// ── MCP JSON-RPC endpoint with SSE transport ──
app.post("/mcp", async (req, res) => {
  if (!isAuthorizedRequest(req)) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="shielddesk-mcp"');
    return res.status(401).json({
      jsonrpc: "2.0" as const,
      id: null,
      error: { code: -32001, message: "Unauthorized", requestId: res.locals.requestId },
    });
  }

  const acceptsSse = req.headers.accept?.includes("text/event-stream");

  try {
    const result = await handleJsonRpc(req.body, log);

    if (result === null) {
      res.sendStatus(204);
      return;
    }

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
    log.error({ err, requestId: res.locals.requestId }, "Unhandled error in MCP handler");
    const errorResponse = {
      jsonrpc: "2.0" as const,
      id: null,
      error: { code: -32603, message: "Internal error", requestId: res.locals.requestId },
    };
    res.status(500).json(errorResponse);
  }
});

// ── Start server ──
const port = config.MCP_PORT;
app.listen(port, () => {
  log.info({ port }, "MCP server listening");
});
