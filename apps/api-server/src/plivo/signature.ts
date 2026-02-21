import crypto from "node:crypto";

export interface PlivoSignatureInput {
  authToken: string;
  url: string;
  nonce: string;
  signature: string;
}

export function buildPlivoSignedUrl(
  publicBaseUrl: string,
  originalUrl: string
): string {
  const base = publicBaseUrl.replace(/\/$/, "");
  const path = originalUrl.startsWith("/") ? originalUrl : `/${originalUrl}`;
  return `${base}${path}`;
}

export function computePlivoSignatureV2(
  authToken: string,
  url: string,
  nonce: string
): string {
  return crypto
    .createHmac("sha256", authToken)
    .update(`${url}${nonce}`)
    .digest("base64");
}

export function isValidPlivoSignatureV2(input: PlivoSignatureInput): boolean {
  const expected = computePlivoSignatureV2(
    input.authToken,
    input.url,
    input.nonce
  );
  const actual = input.signature.trim();

  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(actual, "utf8");
  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

