import pino from "pino";
import { config } from "../config.js";
import { evaluatePolicy } from "./decision.js";
import { getRiskScore } from "./risk-scores.js";
import {
  isArmorIqEnabled,
  capturePlan,
  getIntentToken,
  invoke as armoriqInvoke,
} from "./armoriq-client.js";
import type { Sentiment, TrustLevel } from "@shielddesk/shared";
import { fetchWithProviderPolicy } from "../provider-http.js";

const log = pino({ name: "policy-executor" });

export interface GovernanceInput {
  toolName: string;
  toolArgs: Record<string, unknown>;
  confidence: number;
  sentiment: Sentiment;
  trustLevel: TrustLevel;
  conversationId?: string;
  customerId?: string;
}

export interface GovernanceResult {
  decision: "allow" | "deny" | "escalate";
  reason: string;
  toolResult?: unknown;
  armoriqTokenId?: string;
  armoriqPlanHash?: string;
  armoriqVerified?: boolean;
  effectiveThreshold: number;
  riskScore: number;
}

/**
 * Execute a tool call with full governance:
 * 1. Run decision function
 * 2. If ALLOW: ArmorIQ capturePlan → getIntentToken → invoke → MCP execute
 * 3. If DENY/ESCALATE: Return decision without executing
 */
export async function executeWithGovernance(
  input: GovernanceInput
): Promise<GovernanceResult> {
  const riskScore = getRiskScore(input.toolName);

  // Step 1: Run decision function
  const policyDecision = evaluatePolicy({
    confidence: input.confidence,
    riskScore,
    sentiment: input.sentiment,
    trustLevel: input.trustLevel,
  });

  log.info(
    {
      toolName: input.toolName,
      decision: policyDecision.decision,
      confidence: input.confidence,
      riskScore,
      effectiveThreshold: policyDecision.effectiveThreshold,
      sentiment: input.sentiment,
      trustLevel: input.trustLevel,
      conversationId: input.conversationId,
    },
    "Policy decision"
  );

  const base = {
    effectiveThreshold: policyDecision.effectiveThreshold,
    riskScore,
  };

  // Step 2: DENY — return immediately
  if (policyDecision.decision === "deny") {
    return {
      ...base,
      decision: "deny",
      reason: policyDecision.reason,
    };
  }

  // Step 3: ESCALATE — return immediately
  if (policyDecision.decision === "escalate") {
    return {
      ...base,
      decision: "escalate",
      reason: policyDecision.reason,
    };
  }

  // Step 4: ALLOW — use ArmorIQ when configured, otherwise call MCP directly
  let armoriqTokenId: string | undefined;
  let armoriqPlanHash: string | undefined;
  let armoriqVerified = false;

  if (isArmorIqEnabled()) {
    try {
      const plan = JSON.stringify({
        tool: input.toolName,
        args: input.toolArgs,
        decision: policyDecision.decision,
      });
      const prompt = `Execute ${input.toolName} for conversation ${input.conversationId ?? "unknown"}`;

      const planCapture = await capturePlan(
        config.MINIMAX_MODEL,
        prompt,
        plan,
        {
          conversationId: input.conversationId,
          customerId: input.customerId,
          riskScore,
          confidence: input.confidence,
          sentiment: input.sentiment,
          trustLevel: input.trustLevel,
        }
      );

      const token = await getIntentToken(planCapture, "shielddesk-support", 300);

      const armorResult = await armoriqInvoke(
        config.MCP_SERVER_URL,
        input.toolName,
        token,
        input.toolArgs,
        {
          conversationId: input.conversationId,
          customerId: input.customerId,
        },
      );

      log.info(
        { toolName: input.toolName, tokenId: armorResult.tokenId, verified: armorResult.verified },
        "ArmorIQ execution complete"
      );

      return {
        ...base,
        decision: "allow",
        reason: policyDecision.reason,
        toolResult: armorResult.result,
        armoriqTokenId: armorResult.tokenId,
        armoriqPlanHash: armorResult.planHash,
        armoriqVerified: armorResult.verified,
      };
    } catch (armorErr) {
      log.warn(
        { err: armorErr, toolName: input.toolName },
        "ArmorIQ failed; escalating instead of bypassing verification"
      );
      return {
        ...base,
        decision: "escalate",
        reason:
          "ArmorIQ verification is currently unavailable. This action requires human review.",
      };
    }
  } else {
    log.info({ toolName: input.toolName }, "ArmorIQ not configured, using direct MCP");
  }

  // Execute directly via MCP when ArmorIQ is not configured
  try {
    const mcpResult = await callMcpServer(input.toolName, input.toolArgs, {
      conversationId: input.conversationId,
      customerId: input.customerId,
    });
    return {
      ...base,
      decision: "allow",
      reason: policyDecision.reason,
      toolResult: mcpResult,
      armoriqVerified: false,
    };
  } catch (err) {
    log.error({ err, toolName: input.toolName }, "MCP tool execution failed");
    return {
      ...base,
      decision: "deny",
      reason: `Execution failed: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}

/**
 * Call the MCP tool server via JSON-RPC 2.0
 */
async function callMcpServer(
  toolName: string,
  toolArgs: Record<string, unknown>,
  context: { customerId?: string; conversationId?: string },
): Promise<unknown> {
  const response = await fetchWithProviderPolicy(
    config.MCP_SERVER_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.MCP_AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: {
          name: toolName,
          arguments: toolArgs,
          context,
        },
      }),
    },
    { timeoutMs: config.PROVIDER_TIMEOUT_MS, maxAttempts: 1 },
  );

  if (!response.ok) {
    throw new Error(`MCP server returned ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("text/event-stream")) {
    // Parse SSE response
    const text = await response.text();
    const dataLine = text
      .split("\n")
      .find((line) => line.startsWith("data: "));
    if (!dataLine) throw new Error("No data in SSE response");
    const parsed = JSON.parse(dataLine.slice(6));
    if (parsed.error) {
      throw new Error(parsed.error.message);
    }
    return parsed.result;
  }

  // Plain JSON response
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message);
  }
  return data.result;
}
