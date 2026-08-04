import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import express from "express";

process.env.PORT = process.env.PORT ?? "3000";
process.env.CONVEX_URL = process.env.CONVEX_URL ?? "https://example.invalid";
process.env.MINIMAX_API_KEY = process.env.MINIMAX_API_KEY ?? "test-minimax";
process.env.MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN ?? "test-mcp-token";

const { createToolCallsRouter } = await import("../src/vapi/tool-calls.js");

type EventPayload = {
  conversationId: string;
  kind: string;
  actorKind: string;
  payload: Record<string, unknown>;
};

let server: Server;
let baseUrl = "";

const actionWrites: Array<{ status?: string }> = [];
const eventWrites: EventPayload[] = [];
const statusWrites: Array<{ conversationId: string; status: string }> = [];
const ensuredConversations: Array<{ channelSessionId?: string; customerId?: string }> = [];
const clearedSentiments: string[] = [];

const createRouter = (
  behavior: "allow" | "escalate" | "throw" | "replay",
  overrides: Parameters<typeof createToolCallsRouter>[0] = {},
) =>
  createToolCallsRouter({
    now: () => 1000,
    getSentiment: () => "neutral",
    clearSentiment: (callId) => {
      clearedSentiments.push(callId);
    },
    getRiskScore: () => 0.05,
    allowClientGovernanceOverrides: false,
    ensureConversation: async (input) => {
      ensuredConversations.push({ channelSessionId: input.channelSessionId, customerId: input.customerId });
      return "conv_test";
    },
    claimAgentAction: async (input) => {
      actionWrites.push({ status: input.status });
      if (behavior === "replay") {
        return {
          claimed: false,
          existing: {
            status: "executed" as const,
            policyDecision: "allow" as const,
            result: { content: [{ text: "{\"already\":true}" }] },
          },
        };
      }
      return { claimed: true };
    },
    upsertAgentAction: async (input) => {
      actionWrites.push({ status: input.status });
    },
    recordConversationEvent: async (
      conversationId,
      kind,
      actorKind,
      payload
    ) => {
      eventWrites.push({ conversationId, kind, actorKind, payload });
    },
    updateConversationStatus: async (conversationId, status) => {
      statusWrites.push({ conversationId, status });
    },
    executeWithGovernance: async () => {
      if (behavior === "throw") {
        throw new Error("governance exploded");
      }

      if (behavior === "escalate") {
        return {
          decision: "escalate" as const,
          reason: "Needs manual review",
          effectiveThreshold: 0.56,
          riskScore: 0.6,
        };
      }

      return {
        decision: "allow" as const,
        reason: "Allowed",
        effectiveThreshold: 0.4,
        riskScore: 0.05,
        toolResult: {
          content: [{ text: "{\"ok\":true}" }],
        },
      };
    },
    ...overrides,
  });

async function startServer(
  behavior: "allow" | "escalate" | "throw" | "replay",
  overrides: Parameters<typeof createToolCallsRouter>[0] = {},
) {
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  actionWrites.length = 0;
  eventWrites.length = 0;
  statusWrites.length = 0;
  ensuredConversations.length = 0;
  clearedSentiments.length = 0;

  const app = express();
  app.use(express.json());
  app.use(createRouter(behavior, overrides));

  server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve route test server address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
}

after(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

describe("tool-calls route persistence", () => {
  before(async () => {
    await startServer("allow");
  });

  after(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it("persists non-tool channel events and completes hang events", async () => {
    const response = await fetch(`${baseUrl}/tool-calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          type: "hang",
          call: { id: "call_hang" },
          metadata: {},
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(ensuredConversations.length, 1);
    assert.equal(eventWrites[0]?.kind, "channel_event");
    assert.equal(eventWrites[0]?.payload.messageType, "hang");
    assert.deepEqual(statusWrites, [
      { conversationId: "conv_test", status: "completed" },
    ]);
    assert.deepEqual(clearedSentiments, ["call_hang"]);
  });

  it("persists allow decisions and returns the tool result", async () => {
    const response = await fetch(`${baseUrl}/tool-calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          type: "tool-calls",
          call: { id: "call_allow" },
          metadata: {},
          toolCallList: [
            {
              id: "tc_1",
              type: "function",
              function: {
                name: "order_lookup",
                arguments: "{\"orderNumber\":\"ORD-1234\"}",
              },
            },
          ],
        },
      }),
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      results: Array<{ result: string }>;
    };
    assert.equal(body.results[0]?.result, "{\"ok\":true}");
    assert.deepEqual(
      actionWrites.map((entry) => entry.status),
      ["policy_checking", "executed"]
    );
    assert.equal(eventWrites.at(-1)?.kind, "tool_called");
  });

  it("normalizes an external customer reference before persistence", async () => {
    await startServer("allow", {
      allowClientGovernanceOverrides: true,
      resolveGovernanceContext: () => ({
        trustLevel: 2,
        sentiment: "neutral",
        confidence: 0.95,
        conversationId: undefined,
        customerId: "cust_external_01",
      }),
      resolveCustomerReference: async (reference) => {
        assert.equal(reference, "cust_external_01");
        return "customer_doc_01";
      },
    });

    const response = await fetch(`${baseUrl}/tool-calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          type: "tool-calls",
          call: { id: "call_identity" },
          metadata: { customerId: "cust_external_01" },
          toolCallList: [
            {
              id: "tc_identity",
              type: "function",
              function: {
                name: "order_lookup",
                arguments: { orderNumber: "ORD-1234" },
              },
            },
          ],
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(ensuredConversations[0]?.customerId, "customer_doc_01");
  });

  it("refuses tool execution when the audit session cannot be established", async () => {
    await startServer("allow", {
      ensureConversation: async () => {
        throw new Error("Convex unavailable");
      },
      executeWithGovernance: async () => {
        throw new Error("governance must not run");
      },
    });

    const response = await fetch(`${baseUrl}/tool-calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          type: "tool-calls",
          call: { id: "call_no_audit" },
          metadata: {},
          toolCallList: [
            {
              id: "tc_no_audit",
              type: "function",
              function: {
                name: "order_lookup",
                arguments: { orderNumber: "ORD-1234" },
              },
            },
          ],
        },
      }),
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as { results: Array<{ result: string }> };
    assert.match(body.results[0]?.result ?? "", /safe audited session/);
    assert.deepEqual(actionWrites, []);
  });
});

describe("tool-calls route non-allow outcomes", () => {
  it("replays an existing terminal action without invoking governance again", async () => {
    await startServer("replay");
    const response = await fetch(`${baseUrl}/tool-calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          type: "tool-calls",
          call: { id: "call_replay" },
          metadata: {},
          toolCallList: [
            {
              id: "tc_replay",
              type: "function",
              function: {
                name: "order_lookup",
                arguments: { orderNumber: "ORD-1234" },
              },
            },
          ],
        },
      }),
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as { results: Array<{ result: string }> };
    assert.equal(body.results[0]?.result, "{\"already\":true}");
    assert.deepEqual(actionWrites.map((entry) => entry.status), ["policy_checking"]);
  });

  it("persists escalations", async () => {
    await startServer("escalate");
    const response = await fetch(`${baseUrl}/tool-calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          type: "tool-calls",
          call: { id: "call_escalate" },
          metadata: {},
          toolCallList: [
            {
              id: "tc_2",
              type: "function",
              function: {
                name: "order_refund",
                arguments: { orderId: "ord_1" },
              },
            },
          ],
        },
      }),
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      results: Array<{ result: string }>;
    };
    assert.match(body.results[0]?.result ?? "", /manual review/);
    assert.deepEqual(
      actionWrites.map((entry) => entry.status),
      ["policy_checking", "escalated"]
    );
    assert.equal(eventWrites.at(-1)?.kind, "tool_escalated");
  });

  it("persists failed executions when governance throws", async () => {
    await startServer("throw");
    const response = await fetch(`${baseUrl}/tool-calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          type: "tool-calls",
          call: { id: "call_fail" },
          metadata: {},
          toolCallList: [
            {
              id: "tc_3",
              type: "function",
              function: {
                name: "account_lookup",
                arguments: { customerId: "cust_1" },
              },
            },
          ],
        },
      }),
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      results: Array<{ result: string }>;
    };
    assert.match(body.results[0]?.result ?? "", /issue processing that request/);
    assert.deepEqual(
      actionWrites.map((entry) => entry.status),
      ["policy_checking", "failed"]
    );
    assert.equal(eventWrites.at(-1)?.kind, "tool_failed");
  });
});
