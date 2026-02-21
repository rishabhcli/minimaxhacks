import pino from "pino";
import { config } from "../config.js";
import { evaluatePolicy } from "./decision.js";
import { getRiskScore } from "./risk-scores.js";
import type { Sentiment, TrustLevel } from "@shielddesk/shared";
import { ArmorIQClient } from "@armoriq/sdk";

const log = pino({ name: "policy-executor" });
let armoriqClient: ArmorIQClient | null | undefined;

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

function hasArmorIqConfig(): boolean {
  return Boolean(
    config.ARMORIQ_API_KEY &&
      config.ARMORIQ_USER_ID &&
      config.ARMORIQ_AGENT_ID
  );
}

function getArmorIqClient(): ArmorIQClient | null {
  if (!hasArmorIqConfig()) return null;
  if (armoriqClient !== undefined) return armoriqClient;

  const localProxyBase = config.MCP_SERVER_URL.replace(/\/mcp$/, "");
  const proxyEndpoints = config.ARMORIQ_LOCAL_PROXY_MODE
    ? { [config.ARMORIQ_MCP_ID]: localProxyBase }
    : undefined;

  armoriqClient = new ArmorIQClient({
    apiKey: config.ARMORIQ_API_KEY,
    userId: config.ARMORIQ_USER_ID,
    agentId: config.ARMORIQ_AGENT_ID,
    contextId: config.ARMORIQ_CONTEXT_ID,
    proxyEndpoints,
  });

  log.info(
    {
      userId: config.ARMORIQ_USER_ID,
      agentId: config.ARMORIQ_AGENT_ID,
      contextId: config.ARMORIQ_CONTEXT_ID,
      mcpId: config.ARMORIQ_MCP_ID,
      localProxyMode: config.ARMORIQ_LOCAL_PROXY_MODE,
      localProxyBase: config.ARMORIQ_LOCAL_PROXY_MODE
        ? localProxyBase
        : undefined,
    },
    "ArmorIQ client initialized"
  );

  return armoriqClient;
}

function buildArmorIqPlan(input: GovernanceInput): Record<string, unknown> {
  return {
    goal: `Execute governed support action: ${input.toolName}`,
    steps: [
      {
        action: input.toolName,
        mcp: config.ARMORIQ_MCP_ID,
        inputs: input.toolArgs,
      },
    ],
  };
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

  // Step 4: ALLOW — execute via ArmorIQ → MCP
  try {
    const armorIq = getArmorIqClient();

    if (!armorIq) {
      // Graceful local fallback when ArmorIQ credentials are not configured.
      const mcpResult = await callMcpServer(input.toolName, input.toolArgs);
      return {
        ...base,
        decision: "allow",
        reason: `${policyDecision.reason} (ArmorIQ not configured; executed via direct MCP fallback)`,
        toolResult: mcpResult,
        armoriqVerified: false,
      };
    }

    const plan = buildArmorIqPlan(input);
    const prompt = `Execute ${input.toolName} with governed policy checks for support conversation`;
    const planCapture = armorIq.capturePlan(
      config.MINIMAX_MODEL,
      prompt,
      plan,
      {
        conversationId: input.conversationId,
        customerId: input.customerId,
        sentiment: input.sentiment,
        trustLevel: input.trustLevel,
      }
    );

    const intentToken = await armorIq.getIntentToken(
      planCapture,
      undefined,
      300
    );
    const invocation = await armorIq.invoke(
      config.ARMORIQ_MCP_ID,
      input.toolName,
      intentToken,
      input.toolArgs
    );
    const armoriqVerified = config.ARMORIQ_LOCAL_PROXY_MODE
      ? false
      : invocation.verified;
    const reason = config.ARMORIQ_LOCAL_PROXY_MODE
      ? `${policyDecision.reason} (executed via local proxy compatibility mode; cryptographic proxy verification bypassed)`
      : policyDecision.reason;

    return {
      ...base,
      decision: "allow",
      reason,
      toolResult: invocation.result,
      armoriqTokenId: intentToken.tokenId,
      armoriqPlanHash: intentToken.planHash,
      armoriqVerified,
    };
  } catch (err) {
    // Fail closed: if ArmorIQ is configured and fails, deny execution.
    // This preserves governance guarantees.
    log.error(
      { err, toolName: input.toolName, armoriqConfigured: hasArmorIqConfig() },
      "Tool execution failed"
    );
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
