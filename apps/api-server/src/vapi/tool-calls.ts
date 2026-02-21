import { Router } from "express";
import { z } from "zod";
import pino from "pino";
import { executeWithGovernance } from "../policy/executor.js";
import type { Sentiment, TrustLevel } from "@shielddesk/shared";

const log = pino({ name: "vapi-tool-calls" });

const router = Router();

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

// ── POST /vapi/tool-calls ──

router.post("/tool-calls", async (req, res) => {
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
  const trustLevel = (
    typeof sessionMeta.trustLevel === "number"
      ? sessionMeta.trustLevel
      : 2
  ) as TrustLevel;
  const sentiment = (
    typeof sessionMeta.sentiment === "string"
      ? sessionMeta.sentiment
      : "neutral"
  ) as Sentiment;
  const conversationId =
    typeof sessionMeta.conversationId === "string"
      ? sessionMeta.conversationId
      : undefined;
  const customerId =
    typeof sessionMeta.customerId === "string"
      ? sessionMeta.customerId
      : undefined;

  // Process each tool call through governance
  const results = await Promise.all(
    toolCallList.map(async (toolCall) => {
      const toolName = toolCall.function.name;

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

      // Default confidence — in production, this comes from MiniMax intent extraction
      const confidence = typeof sessionMeta.confidence === "number"
        ? sessionMeta.confidence
        : 0.90;

      try {
        const govResult = await executeWithGovernance({
          toolName,
          toolArgs,
          confidence,
          sentiment,
          trustLevel,
          conversationId,
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
          return {
            toolCallId: toolCall.id,
            result: JSON.stringify({
              escalated: true,
              message: `This action requires additional verification. ${govResult.reason}. I've flagged this for a human agent to review.`,
            }),
          };
        }

        // DENY
        return {
          toolCallId: toolCall.id,
          result: JSON.stringify({
            denied: true,
            message: `This action cannot be performed automatically. ${govResult.reason}.`,
          }),
        };
      } catch (err) {
        log.error({ err, toolName }, "Governance execution error");
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

export { router as toolCallsRouter };
