/** OpenAI-format function definitions for MiniMax M2.5 */
export const TOOL_FUNCTION_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "faq.search",
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
      name: "order.lookup",
      description: "Look up order details by order number",
      parameters: {
        type: "object",
        properties: {
          orderNumber: { type: "string", description: "The order number" },
          customerId: { type: "string", description: "Optional customer ID" },
        },
        required: ["orderNumber"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "account.lookup",
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
      name: "ticket.create",
      description: "Create a support ticket",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "Ticket subject" },
          description: { type: "string", description: "Issue description" },
          priority: {
            type: "string",
            enum: ["low", "medium", "high", "urgent"],
          },
          customerId: { type: "string", description: "Customer ID" },
        },
        required: ["subject", "description"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ticket.escalate",
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
      name: "account.update",
      description: "Update customer account fields",
      parameters: {
        type: "object",
        properties: {
          customerId: { type: "string", description: "Customer ID" },
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
      name: "order.refund",
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
