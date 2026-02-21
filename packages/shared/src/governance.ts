import { z } from "zod";

// ── Self-hosted governance types ──

export const GovernanceProofSchema = z.object({
  digest: z.string(),
  timestamp: z.number(),
  verified: z.boolean(),
});
export type GovernanceProof = z.infer<typeof GovernanceProofSchema>;
