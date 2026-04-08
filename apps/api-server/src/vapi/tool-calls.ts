import { Router } from "express";
import { z } from "zod";
import pino from "pino";
import { config } from "../config.js";
import { executeWithGovernance } from "../policy/executor.js";
import { resolveGovernanceContext } from "./governance-context.js";
import { toMcpToolName } from "./tool-definitions.js";
import { getSentiment } from "./sentiment.js";
import { getRiskScore } from "../policy/risk-scores.js";
import {
  ensureConversation,
  recordConversationEvent,
  updateConversationStatus,
  upsertAgentAction,
} from "../conversation-audit.js";

const log = pino({ name: "vapi-tool-calls" });

// ── Zod schema for VAPI tool-calls webhook ──

const ToolCallItemSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    arguments: z.union([z.record(z.unknown()), z.string()]),
  }),
});

const VapiToolCallWebhookSchema = z.object({
  message: z.object({
    type: z.literal("tool-calls"),
    toolCallList: z.array(ToolCallItemSchema),
    call: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
});

interface ToolCallsDeps {
  executeWithGovernance: typeof executeWithGovernance;
  resolveGovernanceContext: typeof resolveGovernanceContext;
  toMcpToolName: typeof toMcpToolName;
  getSentiment: typeof getSentiment;
  getRiskScore: typeof getRiskScore;
  ensureConversation: typeof ensureConversation;
  recordConversationEvent: typeof recordConversationEvent;
  updateConversationStatus: typeof updateConversationStatus;
  upsertAgentAction: typeof upsertAgentAction;
  allowClientGovernanceOverrides: boolean;
  now: () => number;
}

const defaultDeps: ToolCallsDeps = {
  executeWithGovernance,
  resolveGovernanceContext,
  toMcpToolName,
  getSentiment,
  getRiskScore,
  ensureConversation,
  recordConversationEvent,
  updateConversationStatus,
  upsertAgentAction,
  allowClientGovernanceOverrides: config.ALLOW_CLIENT_GOVERNANCE_OVERRIDES,
  now: () => Date.now(),
};

// ── POST /vapi/tool-calls ──
// VAPI sends ALL webhook events to serverUrl (status-update, speech-update,
// conversation-update, hang, end-of-call-report, etc). We must return 200
// for non-tool-calls events or VAPI treats it as a fatal error and drops the call.

export function createToolCallsRouter(
  overrides: Partial<ToolCallsDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  const router = Router();

  router.post("/tool-calls", async (req, res) => {
    // Check if this is actually a tool-calls event
    const messageType = req.body?.message?.type;
    if (messageType && messageType !== "tool-calls") {
      const sessionMeta =
        req.body?.message?.metadata &&
        typeof req.body.message.metadata === "object"
          ? (req.body.message.metadata as Record<string, unknown>)
          : {};
      const callId =
        typeof req.body?.message?.call?.id === "string"
          ? (req.body.message.call.id as string)
          : undefined;

      if (callId) {
        const detectedSentiment = deps.getSentiment(callId);
        const { trustLevel, sentiment, customerId } = deps.resolveGovernanceContext({
          sessionMeta,
          detectedSentiment,
          allowClientOverrides: deps.allowClientGovernanceOverrides,
        });

        try {
          const conversationId = await deps.ensureConversation({
            channelType: "vapi_web",
            channelSessionId: callId,
            customerId,
            trustLevel,
            sentimentScore: sentiment,
          });

          await deps.recordConversationEvent(conversationId, "channel_event", "system", {
            messageType,
          });

          if (messageType === "hang" || messageType === "end-of-call-report") {
            await deps.updateConversationStatus(conversationId, "completed");
          }
        } catch (err) {
          log.warn(
            { err, type: messageType, callId },
            "Failed to persist non-tool-call VAPI event"
          );
        }
      }

      log.debug({ type: messageType }, "Non-tool-call VAPI event, acknowledging");
      res.status(200).json({});
      return;
    }

    const parseResult = VapiToolCallWebhookSchema.safeParse(req.body);
    if (!parseResult.success) {
      log.warn({ errors: parseResult.error.issues }, "Invalid tool-calls payload");
      res.status(400).json({
        error: { message: "Invalid payload", details: parseResult.error.issues },
      });
      return;
    }

    const { message } = parseResult.data;
    const { toolCallList, call, metadata } = message;

    log.info(
      {
        toolCount: toolCallList.length,
        tools: toolCallList.map((tc) => tc.function.name),
        callId: call?.id,
      },
      "Tool-calls webhook from VAPI"
    );

    // Extract session context from metadata (set by VAPI widget via assistantOverrides)
    const sessionMeta = metadata ?? {};
    // Prefer live-detected sentiment from cache. Metadata is only considered in explicit demo mode.
    const callId = typeof call?.id === "string" ? call.id : undefined;
    const detectedSentiment = callId ? deps.getSentiment(callId) : "neutral";
    const { trustLevel, sentiment, confidence, conversationId, customerId } =
      deps.resolveGovernanceContext({
        sessionMeta,
        detectedSentiment,
        allowClientOverrides: deps.allowClientGovernanceOverrides,
      });
    let resolvedConversationId = conversationId;

    if (callId) {
      try {
        resolvedConversationId = await deps.ensureConversation({
          channelType: "vapi_web",
          channelSessionId: callId,
          customerId,
          trustLevel,
          sentimentScore: sentiment,
        });
      } catch (err) {
        log.warn({ err, callId }, "Failed to ensure conversation before tool execution");
      }
    }

    // Process each tool call through governance
    const results = await Promise.all(
      toolCallList.map(async (toolCall) => {
        // VAPI/MiniMax use underscore names (faq_search); MCP/governance use dots (faq.search)
        const toolName = deps.toMcpToolName(toolCall.function.name);

        // Parse arguments — VAPI may send as string or object
        let toolArgs: Record<string, unknown>;
        if (typeof toolCall.function.arguments === "string") {
          try {
            toolArgs = JSON.parse(toolCall.function.arguments);
          } catch {
            log.warn(
              { raw: toolCall.function.arguments },
              "Failed to parse tool arguments"
            );
            return {
              toolCallId: toolCall.id,
              result: JSON.stringify({
                error: "I had trouble understanding that request. Could you try again?",
              }),
            };
          }
        } else {
          toolArgs = toolCall.function.arguments;
        }

        const idempotencyKey = `vapi:${toolCall.id}`;
        const riskScore = deps.getRiskScore(toolName);
        const startedAt = deps.now();

        if (resolvedConversationId) {
          try {
            await deps.upsertAgentAction({
              conversationId: resolvedConversationId,
              customerId,
              toolName,
              toolArgs,
              status: "policy_checking",
              confidence,
              riskScore,
              sentimentAtTime: sentiment,
              idempotencyKey,
            });
          } catch (err) {
            log.warn(
              { err, toolName, toolCallId: toolCall.id },
              "Failed to persist policy-checking action"
            );
          }
        }

        try {
          const govResult = await deps.executeWithGovernance({
            toolName,
            toolArgs,
            confidence,
            sentiment,
            trustLevel,
            conversationId: resolvedConversationId,
            customerId,
          });

          log.info(
            {
              toolName,
              decision: govResult.decision,
              riskScore: govResult.riskScore,
              effectiveThreshold: govResult.effectiveThreshold,
            },
            "Governance result"
          );

          if (govResult.decision === "allow") {
            if (resolvedConversationId) {
              try {
                await Promise.all([
                  deps.upsertAgentAction({
                    conversationId: resolvedConversationId,
                    customerId,
                    toolName,
                    toolArgs,
                    status: "executed",
                    confidence,
                    riskScore: govResult.riskScore,
                    effectiveThreshold: govResult.effectiveThreshold,
                    sentimentAtTime: sentiment,
                    policyDecision: govResult.decision,
                    policyReason: govResult.reason,
                    armoriqTokenId: govResult.armoriqTokenId,
                    armoriqPlanHash: govResult.armoriqPlanHash,
                    armoriqVerified: govResult.armoriqVerified,
                    result: govResult.toolResult,
                    durationMs: deps.now() - startedAt,
                    idempotencyKey,
                  }),
                  deps.recordConversationEvent(
                    resolvedConversationId,
                    "tool_called",
                    "agent",
                    {
                      toolName,
                      decision: govResult.decision,
                      reason: govResult.reason,
                      verified: govResult.armoriqVerified ?? false,
                    }
                  ),
                ]);
              } catch (err) {
                log.warn(
                  { err, toolName, toolCallId: toolCall.id },
                  "Failed to persist executed action"
                );
              }
            }

            // Tool was executed — return result
            const resultContent =
              govResult.toolResult &&
              typeof govResult.toolResult === "object" &&
              "content" in (govResult.toolResult as Record<string, unknown>)
                ? (
                    (govResult.toolResult as { content: Array<{ text: string }> })
                      .content[0]?.text ?? "{}"
                  )
                : JSON.stringify(govResult.toolResult ?? {});

            return {
              toolCallId: toolCall.id,
              result: resultContent,
            };
          }

          if (govResult.decision === "escalate") {
            if (resolvedConversationId) {
              try {
                await Promise.all([
                  deps.upsertAgentAction({
                    conversationId: resolvedConversationId,
                    customerId,
                    toolName,
                    toolArgs,
                    status: "escalated",
                    confidence,
                    riskScore: govResult.riskScore,
                    effectiveThreshold: govResult.effectiveThreshold,
                    sentimentAtTime: sentiment,
                    policyDecision: govResult.decision,
                    policyReason: govResult.reason,
                    durationMs: deps.now() - startedAt,
                    idempotencyKey,
                  }),
                  deps.recordConversationEvent(
                    resolvedConversationId,
                    "tool_escalated",
                    "system",
                    {
                      toolName,
                      reason: govResult.reason,
                    }
                  ),
                ]);
              } catch (err) {
                log.warn(
                  { err, toolName, toolCallId: toolCall.id },
                  "Failed to persist escalated action"
                );
              }
            }

            return {
              toolCallId: toolCall.id,
              result: JSON.stringify({
                escalated: true,
                message: `This action requires additional verification. ${govResult.reason}. I've flagged this for a human agent to review.`,
              }),
            };
          }

          // DENY
          if (resolvedConversationId) {
            try {
              await Promise.all([
                deps.upsertAgentAction({
                  conversationId: resolvedConversationId,
                  customerId,
                  toolName,
                  toolArgs,
                  status: "blocked",
                  confidence,
                  riskScore: govResult.riskScore,
                  effectiveThreshold: govResult.effectiveThreshold,
                  sentimentAtTime: sentiment,
                  policyDecision: govResult.decision,
                  policyReason: govResult.reason,
                  durationMs: deps.now() - startedAt,
                  idempotencyKey,
                }),
                deps.recordConversationEvent(
                  resolvedConversationId,
                  "tool_blocked",
                  "system",
                  {
                    toolName,
                    reason: govResult.reason,
                  }
                ),
              ]);
            } catch (err) {
              log.warn(
                { err, toolName, toolCallId: toolCall.id },
                "Failed to persist blocked action"
              );
            }
          }

          return {
            toolCallId: toolCall.id,
            result: JSON.stringify({
              denied: true,
              message: `This action cannot be performed automatically. ${govResult.reason}.`,
            }),
          };
        } catch (err) {
          log.error({ err, toolName }, "Governance execution error");
          if (resolvedConversationId) {
            try {
              await Promise.all([
                deps.upsertAgentAction({
                  conversationId: resolvedConversationId,
                  customerId,
                  toolName,
                  toolArgs,
                  status: "failed",
                  confidence,
                  riskScore,
                  sentimentAtTime: sentiment,
                  errorMessage:
                    err instanceof Error ? err.message : "Unknown governance error",
                  durationMs: deps.now() - startedAt,
                  idempotencyKey,
                }),
                deps.recordConversationEvent(
                  resolvedConversationId,
                  "tool_failed",
                  "system",
                  {
                    toolName,
                    error:
                      err instanceof Error ? err.message : "Unknown governance error",
                  }
                ),
              ]);
            } catch (persistErr) {
              log.warn(
                { err: persistErr, toolName, toolCallId: toolCall.id },
                "Failed to persist failed action"
              );
            }
          }

          return {
            toolCallId: toolCall.id,
            result: JSON.stringify({
              error: "I encountered an issue processing that request. Let me create a ticket for you instead.",
            }),
          };
        }
      })
    );

    // Return results in VAPI expected format
    res.json({ results });
  });

  return router;
}

export const toolCallsRouter = createToolCallsRouter();
