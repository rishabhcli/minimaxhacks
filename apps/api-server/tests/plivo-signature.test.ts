import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPlivoSignedUrl,
  computePlivoSignatureV2,
  isValidPlivoSignatureV2,
} from "../src/plivo/signature.js";

describe("Plivo signature helpers", () => {
  it("buildPlivoSignedUrl normalizes slashes", () => {
    assert.equal(
      buildPlivoSignedUrl("https://example.com/", "/plivo/answer?CallUUID=1"),
      "https://example.com/plivo/answer?CallUUID=1"
    );
    assert.equal(
      buildPlivoSignedUrl("https://example.com", "plivo/status"),
      "https://example.com/plivo/status"
    );
  });

  it("validates a correct V2 signature", () => {
    const authToken = "secret-auth-token";
    const url = "https://example.com/plivo/answer?CallUUID=abc123";
    const nonce = "1734500000";
    const signature = computePlivoSignatureV2(authToken, url, nonce);

    assert.equal(
      isValidPlivoSignatureV2({
        authToken,
        url,
        nonce,
        signature,
      }),
      true
    );
  });

  it("rejects an invalid V2 signature", () => {
    const authToken = "secret-auth-token";
    const url = "https://example.com/plivo/answer?CallUUID=abc123";
    const nonce = "1734500000";
    const signature = computePlivoSignatureV2(authToken, url, nonce);

    assert.equal(
      isValidPlivoSignatureV2({
        authToken,
        url,
        nonce,
        signature: `${signature}tampered`,
      }),
      false
    );
  });
});

