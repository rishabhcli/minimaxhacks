import { z } from "zod";
import { convex } from "../convex-client.js";
import { anyApi } from "convex/server";
import { config } from "../config.js";
import { fetchWithProviderPolicy } from "../provider-http.js";

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

export interface ToolExecutionContext {
  customerId?: string;
  conversationId?: string;
}

function requireVerifiedCustomer(
  context: ToolExecutionContext,
  requestedCustomerId: string | undefined,
  toolName: string,
): string {
  if (!context.customerId) {
    throw new Error(`${toolName} requires a verified customer context`);
  }
  if (requestedCustomerId && requestedCustomerId !== context.customerId) {
    throw new Error(`${toolName} customer scope does not match the verified session`);
  }
  return context.customerId;
}

export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext = {},
): Promise<ToolResult> {
  switch (toolName) {
    case "faq.search":
      return handleFaqSearch(args);
    case "order.lookup":
      return handleOrderLookup(args, context);
    case "account.lookup":
      return handleAccountLookup(args, context);
    case "ticket.create":
      return handleTicketCreate(args, context);
    case "ticket.escalate":
      return handleTicketEscalate(args, context);
    case "account.update":
      return handleAccountUpdate(args, context);
    case "order.refund":
      return handleOrderRefund(args, context);
    case "account.delete":
      return handleAccountDelete(args);
    default:
      return textResult(`Unknown tool: ${toolName}`);
  }
}

function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

async function resolveCustomerDocumentId(reference: string): Promise<string> {
  const customer = (await convex.query(api.customers.getByReference, {
    reference,
  })) as { _id: string } | null;

  if (!customer) {
    throw new Error("Verified customer was not found");
  }

  return customer._id;
}

// ── Individual handlers ──

async function handleFaqSearch(
  raw: Record<string, unknown>
): Promise<ToolResult> {
  const input = FaqSearchInput.parse(raw);

  try {
    // Get embedding from MiniMax embo-01
    const embeddingRes = await fetchWithProviderPolicy(
      `${config.MINIMAX_BASE_URL}/embeddings`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.MINIMAX_API_KEY}`,
        },
        body: JSON.stringify({
          model: "embo-01",
          input: [input.query],
          type: "query",
        }),
      },
      { timeoutMs: config.PROVIDER_TIMEOUT_MS, maxAttempts: 2 },
    );

    if (!embeddingRes.ok) {
      throw new Error(`Embedding API returned ${embeddingRes.status}`);
    }

    const embData = await embeddingRes.json();
    const embedding: number[] = embData?.data?.[0]?.embedding;

    if (!embedding || embedding.length !== 1536) {
      throw new Error("Invalid embedding response");
    }

    // Vector search in Convex
    const results = await convex.action(api.knowledgeDocuments.vectorSearch, {
      embedding,
      limit: 5,
    });

    if (results && results.length > 0) {
      return textResult(
        JSON.stringify({
          results: results.map(
            (doc: { title: string; content: string; sourceUrl: string; _score: number }) => ({
              title: doc.title,
              snippet: doc.content.slice(0, 500),
              sourceUrl: doc.sourceUrl,
              relevance: doc._score,
            })
          ),
        })
      );
    }

    // Fall back to text search if no vector results
    const textResults = await convex.query(api.knowledgeDocuments.search, {
      query: input.query,
    });

    return textResult(
      JSON.stringify({
        results: (textResults ?? []).map(
          (doc: { title: string; content: string; sourceUrl: string }) => ({
            title: doc.title,
            snippet: doc.content.slice(0, 500),
            sourceUrl: doc.sourceUrl,
          })
        ),
      })
    );
  } catch (err) {
    // Fall back to text search on any error
    const textResults = await convex.query(api.knowledgeDocuments.search, {
      query: input.query,
    });

    return textResult(
      JSON.stringify({
        results: (textResults ?? []).map(
          (doc: { title: string; content: string; sourceUrl: string }) => ({
            title: doc.title,
            snippet: doc.content.slice(0, 500),
            sourceUrl: doc.sourceUrl,
          })
        ),
      })
    );
  }
}

async function handleOrderLookup(
  raw: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const input = OrderLookupInput.parse(raw);
  const customerId = requireVerifiedCustomer(context, input.customerId, "order.lookup");
  const order = await convex.query(api.orders.getByNumber, {
    orderNumber: input.orderNumber,
    customerId,
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
  raw: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const input = AccountLookupInput.parse(raw);
  const customerId = requireVerifiedCustomer(context, input.customerId, "account.lookup");
  const customer = await convex.query(api.customers.getByReference, {
    reference: customerId,
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
  raw: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const input = TicketCreateInput.parse(raw);
  const customerReference = requireVerifiedCustomer(context, input.customerId, "ticket.create");
  const customerId = await resolveCustomerDocumentId(customerReference);
  const result = await convex.mutation(api.tickets.create, {
    customerId,
    conversationId: context.conversationId,
    subject: input.subject,
    description: input.description,
    priority: input.priority,
  });

  return textResult(JSON.stringify(result));
}

async function handleTicketEscalate(
  raw: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const input = TicketEscalateInput.parse(raw);
  const customerId = requireVerifiedCustomer(context, undefined, "ticket.escalate");
  const result = await convex.mutation(api.tickets.escalate, {
    id: input.ticketId,
    customerId,
    reason: input.reason,
    urgency: input.urgency,
  });

  return textResult(JSON.stringify(result));
}

async function handleAccountUpdate(
  raw: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const input = AccountUpdateInput.parse(raw);
  const customerReference = requireVerifiedCustomer(context, input.customerId, "account.update");
  const customerId = await resolveCustomerDocumentId(customerReference);
  const result = await convex.mutation(api.customers.update, {
    id: customerId,
    email: input.email,
    displayName: input.displayName,
    phoneE164: input.phoneE164,
  });

  return textResult(JSON.stringify(result));
}

async function handleOrderRefund(
  raw: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const input = OrderRefundInput.parse(raw);
  const customerId = requireVerifiedCustomer(context, undefined, "order.refund");
  const orderReference = /^ORD-/i.test(input.orderId)
    ? { orderNumber: input.orderId }
    : { id: input.orderId };
  const result = await convex.mutation(api.orders.refund, {
    ...orderReference,
    customerId,
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
