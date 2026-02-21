import { z } from "zod";

// ── VAPI Custom LLM endpoint types ──

export const VapiMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "function", "tool"]),
  content: z.string().nullable().optional(),
  name: z.string().optional(),
  tool_calls: z
    .array(
      z.object({
        id: z.string(),
        type: z.literal("function"),
        function: z.object({
          name: z.string(),
          arguments: z.string(),
        }),
      })
    )
    .optional(),
  tool_call_id: z.string().optional(),
});
export type VapiMessage = z.infer<typeof VapiMessageSchema>;

export const VapiChatCompletionRequestSchema = z.object({
  model: z.string().optional(),
  messages: z.array(VapiMessageSchema),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  stream: z.boolean().optional(),
  call: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type VapiChatCompletionRequest = z.infer<
  typeof VapiChatCompletionRequestSchema
>;

// ── VAPI Tool-Calls webhook types ──

export const VapiToolCallRequestSchema = z.object({
  message: z.object({
    type: z.literal("tool-calls"),
    toolCallList: z.array(
      z.object({
        id: z.string(),
        type: z.literal("function"),
        function: z.object({
          name: z.string(),
          arguments: z.record(z.unknown()),
        }),
      })
    ),
    call: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
});
export type VapiToolCallRequest = z.infer<typeof VapiToolCallRequestSchema>;

export const VapiToolCallResultSchema = z.object({
  results: z.array(
    z.object({
      toolCallId: z.string(),
      result: z.string(),
    })
  ),
});
export type VapiToolCallResult = z.infer<typeof VapiToolCallResultSchema>;
