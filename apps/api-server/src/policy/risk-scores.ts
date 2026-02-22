/**
 * Pre-assigned risk score for each MCP tool.
 * Risk 0 = read-only, harmless. Risk 1 = destructive, never auto-allowed.
 */
export const TOOL_RISK_SCORES: Record<string, number> = {
  "faq.search": 0.02,
  "order.lookup": 0.05,
  "order.list": 0.05,
  "account.lookup": 0.08,
  "ticket.create": 0.10,
  "ticket.escalate": 0.15,
  "account.update": 0.40,
  "order.refund": 0.60,
  "account.delete": 1.00,
};

export function getRiskScore(toolName: string): number {
  const score = TOOL_RISK_SCORES[toolName];
  if (score === undefined) {
    // Unknown tools default to max risk — fail closed.
    return 1.0;
  }
  return score;
}
