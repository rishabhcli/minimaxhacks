/** OpenAI-format function definitions for MiniMax M2.5 */
export const TOOL_FUNCTION_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "faq_search",
      description: "Search the knowledge base for FAQ answers",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query text" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "order_lookup",
      description: "Look up order details by order number",
      parameters: {
        type: "object",
        properties: {
          orderNumber: { type: "string", description: "The order number" },
          customerId: { type: "string", description: "Optional customer reference; verified session context is required" },
        },
        required: ["orderNumber"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "account_lookup",
      description: "Look up customer account details",
      parameters: {
        type: "object",
        properties: {
          customerId: { type: "string", description: "Customer ID" },
        },
        required: ["customerId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ticket_create",
      description: "Create a support ticket for the verified customer",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "Ticket subject" },
          description: { type: "string", description: "Issue description" },
          priority: {
            type: "string",
            enum: ["low", "medium", "high", "urgent"],
          },
          customerId: { type: "string", description: "Optional customer reference; verified session context is required" },
        },
        required: ["subject", "description"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ticket_escalate",
      description: "Escalate a ticket to a human agent",
      parameters: {
        type: "object",
        properties: {
          ticketId: { type: "string", description: "Ticket ID" },
          reason: { type: "string", description: "Reason for escalation" },
          urgency: { type: "string", enum: ["high", "low"] },
        },
        required: ["ticketId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "account_update",
      description: "Update the verified customer account fields",
      parameters: {
        type: "object",
        properties: {
          customerId: { type: "string", description: "Customer reference; must match verified session context" },
          email: { type: "string", description: "New email" },
          displayName: { type: "string", description: "New display name" },
          phoneE164: { type: "string", description: "New phone (E.164)" },
        },
        required: ["customerId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "order_refund",
      description: "Process a refund for an order",
      parameters: {
        type: "object",
        properties: {
          orderId: { type: "string", description: "Order ID to refund" },
          reason: { type: "string", description: "Reason for refund" },
          amountUsd: { type: "number", description: "Partial refund amount" },
        },
        required: ["orderId"],
      },
    },
  },
];

/**
 * Convert underscore tool names (VAPI/MiniMax) to dot notation (MCP/governance).
 * e.g. "faq_search" → "faq.search", "order_lookup" → "order.lookup"
 */
export function toMcpToolName(vapiName: string): string {
  return vapiName.replace(/_/g, ".");
}
