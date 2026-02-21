import { Router } from "express";
import pino from "pino";
import { config } from "../config.js";
import {
  buildPlivoSignedUrl,
  isValidPlivoSignatureV2,
} from "./signature.js";

const log = pino({ name: "plivo-answer" });

const router = Router();

function validatePlivoSignatureV2(req: {
  headers: Record<string, string | string[] | undefined>;
  originalUrl: string;
}): boolean {
  if (!config.PLIVO_AUTH_TOKEN) {
    // Local development may omit telephony credentials.
    return true;
  }

  const signatureHeader = req.headers["x-plivo-signature-v2"];
  const nonceHeader = req.headers["x-plivo-signature-v2-nonce"];
  const signature =
    typeof signatureHeader === "string" ? signatureHeader : undefined;
  const nonce = typeof nonceHeader === "string" ? nonceHeader : undefined;

  if (!signature || !nonce) {
    return false;
  }

  const signedUrl = buildPlivoSignedUrl(config.PUBLIC_URL, req.originalUrl);
  return isValidPlivoSignatureV2({
    authToken: config.PLIVO_AUTH_TOKEN,
    url: signedUrl,
    nonce,
    signature,
  });
}

/**
 * POST /plivo/answer — Plivo Answer URL
 *
 * Returns <Stream> XML to start bidirectional audio streaming.
 * ALL audio is mulaw 8kHz. No exceptions.
 */
router.post("/answer", (req, res) => {
  if (!validatePlivoSignatureV2(req)) {
    log.warn(
      {
        path: req.originalUrl,
        hasSig: Boolean(req.headers["x-plivo-signature-v2"]),
        hasNonce: Boolean(req.headers["x-plivo-signature-v2-nonce"]),
      },
      "Invalid Plivo signature on /plivo/answer"
    );
    res.status(403).send("Forbidden");
    return;
  }

  const callUuid = req.body?.CallUUID ?? req.query?.CallUUID ?? "unknown";
  const from = req.body?.From ?? req.query?.From ?? "unknown";
  const to = req.body?.To ?? req.query?.To ?? "unknown";

  log.info({ callUuid, from, to }, "Plivo answer URL hit");

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
  if (!validatePlivoSignatureV2(req)) {
    log.warn(
      {
        path: req.originalUrl,
        hasSig: Boolean(req.headers["x-plivo-signature-v2"]),
        hasNonce: Boolean(req.headers["x-plivo-signature-v2-nonce"]),
      },
      "Invalid Plivo signature on /plivo/status"
    );
    res.status(403).send("Forbidden");
    return;
  }

  log.info({ body: req.body }, "Plivo stream status callback");
  res.sendStatus(200);
});

export { router as plivoAnswerRouter };
