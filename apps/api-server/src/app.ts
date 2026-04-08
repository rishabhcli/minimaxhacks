import express from "express";
import { createServer } from "node:http";
import pino from "pino";
import { config } from "./config.js";
import { chatCompletionsRouter } from "./vapi/chat-completions.js";
import { toolCallsRouter } from "./vapi/tool-calls.js";
import { plivoAnswerRouter } from "./plivo/answer.js";
import { attachPlivoWebSocket } from "./plivo/gateway.js";
import { requirePlivoSignature, requireVapiAuth } from "./request-auth.js";

const log = pino({ name: "api-server" });
const allowedOrigins = new Set(config.CORS_ALLOW_ORIGINS);

export function createApiApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: "shielddesk-api", version: "0.1.0" });
  });

  app.use("/vapi", requireVapiAuth(config.VAPI_WEBHOOK_SECRET));
  app.use("/vapi", chatCompletionsRouter);
  app.use("/vapi", toolCallsRouter);

  app.use(
    "/plivo",
    requirePlivoSignature({
      publicUrl: config.PUBLIC_URL,
      authToken: config.PLIVO_AUTH_TOKEN,
    })
  );
  app.use("/plivo", plivoAnswerRouter);

  return app;
}

export function createApiServer() {
  const app = createApiApp();
  const server = createServer(app);
  attachPlivoWebSocket(server);
  return { app, server };
}

export function listen(): void {
  const { server } = createApiServer();
  const port = config.PORT;
  server.listen(port, () => {
    log.info({ port }, "API server listening (HTTP + WebSocket)");
  });
}
