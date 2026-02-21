import pino from "pino";
import { z } from "zod";
import { config } from "../config.js";
import {
  PlanCaptureSchema,
  IntentTokenSchema,
  ArmorIqResultSchema,
  type PlanCapture,
  type IntentToken,
  type ArmorIqResult,
} from "@shielddesk/shared";

const log = pino({ name: "armoriq-client" });

const ARMORIQ_BASE_URL = "https://api.armoriq.ai/v1";

/** Whether ArmorIQ is configured (all 3 keys present) */
export function isArmorIqEnabled(): boolean {
  return !!(
    config.ARMORIQ_API_KEY &&
    config.ARMORIQ_USER_ID &&
    config.ARMORIQ_AGENT_ID
  );
}

async function armoriqFetch(
  path: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const res = await fetch(`${ARMORIQ_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.ARMORIQ_API_KEY}`,
      "X-ArmorIQ-User-ID": config.ARMORIQ_USER_ID,
      "X-ArmorIQ-Agent-ID": config.ARMORIQ_AGENT_ID,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ArmorIQ ${path} returned ${res.status}: ${errText}`);
  }

  return res.json();
}

/**
 * capturePlan(llm, prompt, plan, metadata?)
 * Captures the LLM's proposed action for cryptographic verification.
 */
export async function capturePlan(
  llm: string,
  prompt: string,
  plan: string,
  metadata?: Record<string, unknown>
): Promise<PlanCapture> {
  log.info({ llm, planLength: plan.length }, "ArmorIQ capturePlan");

  const raw = await armoriqFetch("/capture-plan", {
    llm,
    prompt,
    plan,
    metadata,
  });

  return PlanCaptureSchema.parse(raw);
}

/**
 * getIntentToken(planCapture, policy?, validitySeconds?)
 * Gets a cryptographic intent token for the captured plan.
 * Default validity: 300s for support conversations.
 */
export async function getIntentToken(
  planCapture: PlanCapture,
  policy?: string,
  validitySeconds?: number
): Promise<IntentToken> {
  log.info(
    { planHash: planCapture.planHash, validitySeconds: validitySeconds ?? 300 },
    "ArmorIQ getIntentToken"
  );

  const raw = await armoriqFetch("/get-intent-token", {
    planHash: planCapture.planHash,
    capturedAt: planCapture.capturedAt,
    policy: policy ?? "shielddesk-support",
    validitySeconds: validitySeconds ?? 300,
  });

  return IntentTokenSchema.parse(raw);
}

/**
 * invoke(mcp, action, intentToken, params?)
 * Executes the action with cryptographic verification via the intent token.
 */
export async function invoke(
  mcpServerUrl: string,
  action: string,
  intentToken: IntentToken,
  params?: Record<string, unknown>
): Promise<ArmorIqResult> {
  log.info(
    { action, tokenId: intentToken.tokenId },
    "ArmorIQ invoke"
  );

  const raw = await armoriqFetch("/invoke", {
    mcpServerUrl,
    action,
    intentToken: {
      tokenId: intentToken.tokenId,
      planHash: intentToken.planHash,
      expiresAt: intentToken.expiresAt,
    },
    params,
  });

  return ArmorIqResultSchema.parse(raw);
}
