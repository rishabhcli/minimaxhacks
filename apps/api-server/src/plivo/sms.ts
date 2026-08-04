import pino from "pino";
import { config } from "../config.js";
import { fetchWithProviderPolicy } from "../provider-http.js";

const log = pino({ name: "plivo-sms" });
const MAX_SMS_BODY_CHARS = 1_500;

export interface PostCallSummaryInput {
  to: string;
  summary: string;
  fetchImpl?: typeof fetch;
}

function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)}***${phone.slice(-2)}`;
}

function validatePhone(phone: string): string {
  const normalized = phone.trim();
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new Error("Plivo SMS destination must be an E.164 phone number");
  }
  return normalized;
}

/** Send a bounded, caller-visible summary through Plivo's non-idempotent SMS API. */
export async function sendPostCallSummary({ to, summary, fetchImpl }: PostCallSummaryInput): Promise<void> {
  if (!config.PLIVO_AUTH_ID || !config.PLIVO_AUTH_TOKEN || !config.PLIVO_PHONE_NUMBER) {
    throw new Error("Plivo SMS is not configured");
  }

  const destination = validatePhone(to);
  const trimmedSummary = summary.trim();
  if (!trimmedSummary) throw new Error("Cannot send an empty post-call summary");

  const body = `ShieldDesk call summary:\n${trimmedSummary}`.slice(0, MAX_SMS_BODY_CHARS);
  const auth = Buffer.from(`${config.PLIVO_AUTH_ID}:${config.PLIVO_AUTH_TOKEN}`).toString("base64");
  const response = await fetchWithProviderPolicy(
    `https://api.plivo.com/v1/Account/${encodeURIComponent(config.PLIVO_AUTH_ID)}/Message/`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        src: config.PLIVO_PHONE_NUMBER,
        dst: destination,
        text: body,
      }),
    },
    {
      timeoutMs: config.PROVIDER_TIMEOUT_MS,
      // Sending an SMS is non-idempotent. Never retry automatically.
      maxAttempts: 1,
      fetchImpl,
    },
  );

  if (!response.ok) {
    log.error({ status: response.status, destination: maskPhone(destination) }, "Plivo SMS delivery failed");
    throw new Error(`Plivo SMS delivery failed: ${response.status}`);
  }

  log.info({ destination: maskPhone(destination), textLength: body.length }, "Plivo post-call summary sent");
}
