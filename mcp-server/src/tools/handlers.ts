import { z } from "zod";
import { convex } from "../convex-client.js";
import { anyApi } from "convex/server";

// Use anyApi for Convex calls — avoids dependency on codegen.
// Type safety is enforced by Zod at the tool boundary.
const api = anyApi;

// ── Input schemas (Zod validation for every tool) ──

const FaqSearchInput = z.object({
  query: z.string().min(1),
});

const OrderLookupInput = z.object({
  orderNumber: z.string().min(1),
  customerId: z.string().optional(),
});

const AccountLookupInput = z.object({
  customerId: z.string().min(1),
});

const TicketCreateInput = z.object({
  subject: z.string().min(1),
  description: z.string().min(1),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  customerId: z.string().optional(),
});

const TicketEscalateInput = z.object({
  ticketId: z.string().min(1),
  reason: z.string().optional(),
  urgency: z.enum(["high", "low"]).optional(),
});

const AccountUpdateInput = z.object({
  customerId: z.string().min(1),
  email: z.string().email().optional(),
  displayName: z.string().optional(),
  phoneE164: z.string().optional(),
});

const OrderRefundInput = z.object({
  orderId: z.string().min(1),
  reason: z.string().optional(),
  amountUsd: z.number().positive().optional(),
});

const AccountDeleteInput = z.object({
  customerId: z.string().min(1),
  confirmation: z.literal("CONFIRM_DELETE"),
});

// ── Tool handler dispatch ──

export type ToolResult = { content: Array<{ type: "text"; text: string }> };

export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  switch (toolName) {
    case "faq.search":
      return handleFaqSearch(args);
    case "order.lookup":
      return handleOrderLookup(args);
    case "account.lookup":
      return handleAccountLookup(args);
    case "ticket.create":
      return handleTicketCreate(args);
    case "ticket.escalate":
      return handleTicketEscalate(args);
    case "account.update":
      return handleAccountUpdate(args);
    case "order.refund":
      return handleOrderRefund(args);
    case "account.delete":
      return handleAccountDelete(args);
    default:
      return textResult(`Unknown tool: ${toolName}`);
  }
}

function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

// ── Individual handlers ──

async function handleFaqSearch(
  raw: Record<string, unknown>
): Promise<ToolResult> {
  const input = FaqSearchInput.parse(raw);
  // Vector search requires embeddings — stub until RAG pipeline (Layer 3).
  return textResult(
    JSON.stringify({
      results: [
        {
          title: "FAQ Search",
          snippet: `Search results for: "${input.query}" — RAG pipeline not yet wired.`,
          sourceUrl: "https://help.shielddesk.ai",
        },
      ],
    })
  );
}

async function handleOrderLookup(
  raw: Record<string, unknown>
): Promise<ToolResult> {
  const input = OrderLookupInput.parse(raw);
  const order = await convex.query(api.orders.getByNumber, {
    orderNumber: input.orderNumber,
  });

  if (!order) {
    return textResult(
      JSON.stringify({ error: `Order ${input.orderNumber} not found` })
    );
  }

  return textResult(
    JSON.stringify({
      order: {
        orderNumber: order.orderNumber,
        status: order.status,
        items: order.items,
        totalUsd: order.totalUsd,
        placedAt: order.placedAt,
        shippedAt: order.shippedAt,
        deliveredAt: order.deliveredAt,
      },
    })
  );
}

async function handleAccountLookup(
  raw: Record<string, unknown>
): Promise<ToolResult> {
  const input = AccountLookupInput.parse(raw);
  const customer = await convex.query(api.customers.getById, {
    id: input.customerId,
  });

  if (!customer) {
    return textResult(JSON.stringify({ error: "Customer not found" }));
  }

  return textResult(
    JSON.stringify({
      customer: {
        displayName: customer.displayName,
        email: customer.email,
        tier: customer.tier,
        trustLevel: customer.trustLevel,
      },
    })
  );
}

async function handleTicketCreate(
  raw: Record<string, unknown>
): Promise<ToolResult> {
  const input = TicketCreateInput.parse(raw);
  const result = await convex.mutation(api.tickets.create, {
    customerId: input.customerId,
    subject: input.subject,
    description: input.description,
    priority: input.priority,
  });

  return textResult(JSON.stringify(result));
}

async function handleTicketEscalate(
  raw: Record<string, unknown>
): Promise<ToolResult> {
  const input = TicketEscalateInput.parse(raw);
  const result = await convex.mutation(api.tickets.escalate, {
    id: input.ticketId,
    reason: input.reason,
    urgency: input.urgency,
  });

  return textResult(JSON.stringify(result));
}

async function handleAccountUpdate(
  raw: Record<string, unknown>
): Promise<ToolResult> {
  const input = AccountUpdateInput.parse(raw);
  const result = await convex.mutation(api.customers.update, {
    id: input.customerId,
    email: input.email,
    displayName: input.displayName,
    phoneE164: input.phoneE164,
  });

  return textResult(JSON.stringify(result));
}

async function handleOrderRefund(
  raw: Record<string, unknown>
): Promise<ToolResult> {
  const input = OrderRefundInput.parse(raw);
  const result = await convex.mutation(api.orders.refund, {
    id: input.orderId,
    reason: input.reason,
    amountUsd: input.amountUsd,
  });

  return textResult(JSON.stringify(result));
}

async function handleAccountDelete(
  raw: Record<string, unknown>
): Promise<ToolResult> {
  const input = AccountDeleteInput.parse(raw);
  // account.delete is risk 1.0 — should always be DENY at policy layer.
  // If it somehow reaches here, refuse to execute.
  return textResult(
    JSON.stringify({
      error:
        "Account deletion must be performed by an administrator. This action cannot be automated.",
      customerId: input.customerId,
    })
  );
}
