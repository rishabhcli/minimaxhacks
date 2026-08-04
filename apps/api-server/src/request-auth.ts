import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function parseBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const parts = headerValue.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== "bearer" || !parts[1]) return null;
  return parts[1];
}

export function isAuthorizedVapiRequest(
  req: Request,
  expectedSecret: string
): boolean {
  const bearerToken = parseBearerToken(req.header("authorization") ?? undefined);
  if (bearerToken && timingSafeEqualString(bearerToken, expectedSecret)) {
    return true;
  }

  const legacySecret = req.header("x-vapi-secret");
  if (legacySecret && timingSafeEqualString(legacySecret, expectedSecret)) {
    return true;
  }

  return false;
}

export function requireVapiAuth(expectedSecret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!expectedSecret) {
      next();
      return;
    }

    if (!isAuthorizedVapiRequest(req, expectedSecret)) {
      res.status(401).json({
        error: {
          message: "Unauthorized Vapi request",
        },
      });
      return;
    }

    next();
  };
}

function stableStringifyParamValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map((entry) => stableStringifyParamValue(entry)).join(",");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

export function validatePlivoV3Signature(input: {
  method: string;
  url: string;
  nonce: string | undefined;
  signatureHeader: string | undefined;
  authToken: string;
  params?: Record<string, unknown>;
}): boolean {
  const { method, url, nonce, signatureHeader, authToken, params } = input;
  if (!nonce || !signatureHeader || !authToken) return false;

  let payload = url;
  if (method.toUpperCase() === "POST" && params) {
    const sortedKeys = Object.keys(params).sort();
    for (const key of sortedKeys) {
      payload += key;
      payload += stableStringifyParamValue(params[key]);
    }
  }
  payload += nonce;

  const computed = crypto
    .createHmac("sha256", authToken)
    .update(payload)
    .digest("base64");

  return signatureHeader
    .split(",")
    .map((signature) => signature.trim())
    .some((signature) => timingSafeEqualString(signature, computed));
}

export function buildConfiguredPublicUrl(
  publicBaseUrl: string,
  pathWithQuery: string,
  protocolOverride?: "ws" | "wss"
): string {
  if (protocolOverride) {
    const base = publicBaseUrl.replace(/^https?/, protocolOverride);
    return `${base}${pathWithQuery}`;
  }
  return `${publicBaseUrl}${pathWithQuery}`;
}

export function requirePlivoSignature(config: {
  publicUrl: string;
  authToken: string;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!config.authToken) {
      res.status(503).json({
        error: {
          message: "Plivo webhook validation is not configured",
        },
      });
      return;
    }

    const isValid = validatePlivoV3Signature({
      method: req.method,
      url: buildConfiguredPublicUrl(config.publicUrl, req.originalUrl),
      nonce: req.header("x-plivo-signature-v3-nonce") ?? undefined,
      signatureHeader: req.header("x-plivo-signature-v3") ?? undefined,
      authToken: config.authToken,
      params:
        req.method.toUpperCase() === "POST"
          ? (req.body as Record<string, unknown>)
          : undefined,
    });

    if (!isValid) {
      res.status(403).json({
        error: {
          message: "Invalid Plivo signature",
        },
      });
      return;
    }

    next();
  };
}
