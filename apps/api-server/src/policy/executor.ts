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

function buildArmorIqPlan(input: GovernanceInput): string {
  return JSON.stringify({
    goal: `Execute governed support action: ${input.toolName}`,
    tool: input.toolName,
    args: input.toolArgs,
    steps: [
      {
        action: input.toolName,
        mcp: config.ARMORIQ_MCP_ID,
        inputs: input.toolArgs,
      },
    ],
  });
}

function formatExecutionError(error: unknown): string {
  const base = error instanceof Error ? error.message : "unknown error";
  if (base.includes("MCP invocation failed: HTTP 400")) {
    return `${base}. Verify ARMORIQ_MCP_ID is correctly registered and reachable in ArmorIQ MCP registry.`;
  }
  return base;
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

  // Step 4: ALLOW — try ArmorIQ, fall back to direct MCP on any failure
  let armoriqTokenId: string | undefined;
  let armoriqPlanHash: string | undefined;
  let armoriqVerified = false;

  if (isArmorIqEnabled()) {
    try {
      const plan = buildArmorIqPlan(input);
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
        input.toolArgs
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
      // ArmorIQ failed — fall back to direct MCP execution
      // Policy engine already approved; crypto signing is skipped.
      log.warn(
        { err: armorErr, toolName: input.toolName },
        "ArmorIQ failed, falling back to direct MCP execution"
      );
    }
  } else {
    log.info({ toolName: input.toolName }, "ArmorIQ not configured, using direct MCP");
  }

  // Execute directly via MCP (ArmorIQ not configured or failed gracefully)
  try {
    const mcpResult = await callMcpServer(input.toolName, input.toolArgs);
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
      reason: `Execution failed: ${formatExecutionError(err)}`,
    };
  }
}

/**
 * Call the MCP tool server via JSON-RPC 2.0
 */
async function callMcpServer(
  toolName: string,
  toolArgs: Record<string, unknown>
): Promise<unknown> {
  const response = await fetch(config.MCP_SERVER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: {
        name: toolName,
        arguments: toolArgs,
      },
    }),
  });

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
