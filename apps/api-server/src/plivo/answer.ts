import { Router } from "express";
import pino from "pino";
import { config } from "../config.js";

const log = pino({ name: "plivo-answer" });

const router = Router();

/**
 * POST /plivo/answer — Plivo Answer URL
 *
 * Returns <Stream> XML to start bidirectional audio streaming.
 * ALL audio is mulaw 8kHz. No exceptions.
 */
router.post("/answer", (req, res) => {
  const callUuid = req.body?.CallUUID ?? req.query?.CallUUID ?? "unknown";
  const from = req.body?.From ?? req.query?.From;
  const to = req.body?.To ?? req.query?.To;

  log.info({ callUuid, hasFrom: Boolean(from), hasTo: Boolean(to) }, "Plivo answer URL hit");

  // Derive WebSocket URL from PUBLIC_URL
  const wsUrl = config.PUBLIC_URL.replace(/^http/, "ws") + "/plivo/ws";

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream
    bidirectional="true"
    audioTrack="inbound"
    keepCallAlive="true"
    contentType="audio/x-mulaw;rate=8000"
    statusCallbackUrl="${config.PUBLIC_URL}/plivo/status"
    statusCallbackMethod="POST">
    ${wsUrl}
  </Stream>
</Response>`;

  res.setHeader("Content-Type", "application/xml");
  res.send(xml);
});

/**
 * POST /plivo/status — Plivo stream status callback
 */
router.post("/status", (req, res) => {
  log.info(
    {
      callUuid: req.body?.CallUUID ?? req.body?.call_uuid,
      status: req.body?.Status ?? req.body?.status,
      fieldCount: Object.keys(req.body ?? {}).length,
    },
    "Plivo stream status callback"
  );
  res.sendStatus(200);
});

export { router as plivoAnswerRouter };
