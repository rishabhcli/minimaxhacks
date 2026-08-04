import express from "express";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import pino from "pino";
import rateLimit from "express-rate-limit";
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
  const webhookLimiter = rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    limit: config.RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: { message: "Rate limit exceeded", requestId: res.locals.requestId },
      });
    },
  });
  const phoneWebhookLimiter = rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    limit: config.RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: { message: "Rate limit exceeded", requestId: res.locals.requestId },
      });
    },
  });

  app.use((req, res, next) => {
    const supplied = req.header("x-request-id");
    const requestId = supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : randomUUID();
    res.locals.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    next();
  });
  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: true, limit: "64kb" }));

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-Id");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.get("/health", (_req, res) => {
    const configuration = {
      vapiWebhookAuth: Boolean(config.VAPI_WEBHOOK_SECRET),
      plivoWebhookAuth: Boolean(config.PLIVO_AUTH_TOKEN),
      plivoSms: Boolean(config.PLIVO_AUTH_ID && config.PLIVO_AUTH_TOKEN && config.PLIVO_PHONE_NUMBER),
      armorIqPolicy: Boolean(config.ARMORIQ_API_KEY && config.ARMORIQ_USER_ID && config.ARMORIQ_AGENT_ID),
      speechmatics: Boolean(config.SPEECHMATICS_API_KEY),
      elevenLabsTts: Boolean(config.ELEVENLABS_API_KEY && config.ELEVENLABS_VOICE_ID),
    };
    const degraded = Object.entries(configuration)
      .filter(([, configured]) => !configured)
      .map(([provider]) => provider);

    res.json({
      status: "ok",
      server: "shielddesk-api",
      version: "0.1.0",
      requestId: res.locals.requestId,
      readiness: degraded.length ? "degraded" : "configured",
      degraded,
      configuration,
    });
  });

  app.use("/vapi", webhookLimiter);
  app.use("/vapi", requireVapiAuth(config.VAPI_WEBHOOK_SECRET));
  app.use("/vapi", chatCompletionsRouter);
  app.use("/vapi", toolCallsRouter);

  app.use(
    "/plivo",
    phoneWebhookLimiter,
    requirePlivoSignature({
      publicUrl: config.PUBLIC_URL,
      authToken: config.PLIVO_AUTH_TOKEN,
    })
  );
  app.use("/plivo", plivoAnswerRouter);

  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    log.error({ err, requestId: res.locals.requestId }, "Unhandled API request error");
    res.status(500).json({
      error: { message: "Internal server error", requestId: res.locals.requestId },
    });
  });

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
