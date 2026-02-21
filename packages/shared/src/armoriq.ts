import { z } from "zod";

// ── ArmorIQ types ──

export const PlanCaptureSchema = z.object({
  planHash: z.string(),
  capturedAt: z.number(),
  llmModel: z.string(),
  prompt: z.string(),
  plan: z.string(),
  metadata: z.record(z.unknown()).optional(),
});
export type PlanCapture = z.infer<typeof PlanCaptureSchema>;

export const IntentTokenSchema = z.object({
  tokenId: z.string(),
  planHash: z.string(),
  policy: z.string().optional(),
  expiresAt: z.number(),
  issuedAt: z.number(),
});
export type IntentToken = z.infer<typeof IntentTokenSchema>;

export const ArmorIqResultSchema = z.object({
  success: z.boolean(),
  tokenId: z.string(),
  planHash: z.string(),
  verified: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
export type ArmorIqResult = z.infer<typeof ArmorIqResultSchema>;
