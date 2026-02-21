import pino from "pino";
import { config } from "../config.js";
import { evaluatePolicy } from "./decision.js";
import { getRiskScore } from "./risk-scores.js";
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

  // Step 4: ALLOW — execute via ArmorIQ → MCP
  try {
    // ArmorIQ flow: capturePlan → getIntentToken → invoke
    // When ArmorIQ SDK is available, this will be:
    //   const planCapture = await armoriq.capturePlan(llm, prompt, plan, metadata)
    //   const token = await armoriq.getIntentToken(planCapture, policy, 300)
    //   const result = await armoriq.invoke(mcp, action, token, params)
    //
    // For now, execute directly against MCP server
    const mcpResult = await callMcpServer(input.toolName, input.toolArgs);

    return {
      ...base,
      decision: "allow",
      reason: policyDecision.reason,
      toolResult: mcpResult,
      // ArmorIQ fields will be populated when SDK is wired in Layer 2.3
      armoriqVerified: false,
    };
  } catch (err) {
    // Fail closed: if execution fails, report failure
    log.error({ err, toolName: input.toolName }, "Tool execution failed");
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
