/** Pre-assigned risk score for each MCP tool. */
export const TOOL_RISK_SCORES: Record<string, number> = {
  "faq.search": 0.02,
  "order.lookup": 0.05,
  "account.lookup": 0.08,
  "ticket.create": 0.1,
  "ticket.escalate": 0.15,
  "account.update": 0.4,
  "order.refund": 0.6,
  "account.delete": 1.0,
} as const;
