import express from "express";
import { createServer } from "node:http";
import pino from "pino";
import { config } from "./config.js";
import { chatCompletionsRouter } from "./vapi/chat-completions.js";
import { toolCallsRouter } from "./vapi/tool-calls.js";
import { plivoAnswerRouter } from "./plivo/answer.js";
import { attachPlivoWebSocket } from "./plivo/gateway.js";

const log = pino({ name: "api-server" });

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS for dashboard
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  if (_req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// ── Health check ──
app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "shielddesk-api", version: "0.1.0" });
});

// ── VAPI endpoints ──
app.use("/vapi", chatCompletionsRouter);
app.use("/vapi", toolCallsRouter);

// ── Plivo endpoints ──
app.use("/plivo", plivoAnswerRouter);

// ── Create HTTP server (needed for WebSocket upgrade) ──
const server = createServer(app);

// ── Attach Plivo bidirectional WebSocket at /plivo/ws ──
attachPlivoWebSocket(server);

// ── Start server ──
const port = config.PORT;
server.listen(port, () => {
  log.info({ port }, "API server listening (HTTP + WebSocket)");
});
