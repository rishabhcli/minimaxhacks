export interface ToolManifest {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TOOL_MANIFESTS: ToolManifest[] = [
  {
    name: "faq.search",
    description: "Search the knowledge base for FAQ answers (risk: 0.02)",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query text" },
      },
      required: ["query"],
    },
  },
  {
    name: "order.lookup",
    description: "Look up order details by order number (risk: 0.05)",
    inputSchema: {
      type: "object",
      properties: {
        orderNumber: { type: "string", description: "The order number to look up" },
        customerId: { type: "string", description: "Optional customer reference; a verified session context is always required" },
      },
      required: ["orderNumber"],
    },
  },
  {
    name: "account.lookup",
    description: "Look up customer account details (risk: 0.08)",
    inputSchema: {
      type: "object",
      properties: {
        customerId: { type: "string", description: "Customer ID to look up" },
      },
      required: ["customerId"],
    },
  },
  {
    name: "ticket.create",
    description: "Create a support ticket for the verified customer (risk: 0.10)",
    inputSchema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Ticket subject line" },
        description: { type: "string", description: "Detailed description of the issue" },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "urgent"],
          description: "Ticket priority level",
        },
        customerId: { type: "string", description: "Optional customer reference; verified session context is required" },
      },
      required: ["subject", "description"],
    },
  },
  {
    name: "ticket.escalate",
    description: "Escalate a ticket to a human agent (risk: 0.15)",
    inputSchema: {
      type: "object",
      properties: {
        ticketId: { type: "string", description: "Ticket ID to escalate" },
        reason: { type: "string", description: "Reason for escalation" },
        urgency: {
          type: "string",
          enum: ["high", "low"],
          description: "Escalation urgency",
        },
      },
      required: ["ticketId"],
    },
  },
  {
    name: "account.update",
    description: "Update the verified customer account fields (risk: 0.40)",
    inputSchema: {
      type: "object",
      properties: {
        customerId: { type: "string", description: "Customer reference to update; must match verified session context" },
        email: { type: "string", description: "New email address" },
        displayName: { type: "string", description: "New display name" },
        phoneE164: { type: "string", description: "New phone number in E.164 format" },
      },
      required: ["customerId"],
    },
  },
  {
    name: "order.refund",
    description: "Process a refund for an order (risk: 0.60)",
    inputSchema: {
      type: "object",
      properties: {
        orderId: { type: "string", description: "Order number (for example ORD-5678) or internal order ID" },
        reason: { type: "string", description: "Reason for refund" },
        amountUsd: { type: "number", description: "Partial refund amount in USD (omit for full refund)" },
      },
      required: ["orderId"],
    },
  },
  {
    name: "account.delete",
    description: "Delete a customer account — destructive, never auto-allowed (risk: 1.00)",
    inputSchema: {
      type: "object",
      properties: {
        customerId: { type: "string", description: "Customer ID to delete" },
        confirmation: { type: "string", description: "Must be 'CONFIRM_DELETE'" },
      },
      required: ["customerId", "confirmation"],
    },
  },
];

export function getToolManifest(name: string): ToolManifest | undefined {
  return TOOL_MANIFESTS.find((t) => t.name === name);
}
