import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import express from "express";

process.env.PORT = process.env.PORT ?? "3000";
process.env.CONVEX_URL = process.env.CONVEX_URL ?? "https://example.invalid";
process.env.MINIMAX_API_KEY = process.env.MINIMAX_API_KEY ?? "test-minimax";
process.env.MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN ?? "test-mcp-token";

const { createChatCompletionsRouter } = await import(
  "../src/vapi/chat-completions.js"
);

type RecordedMessage = {
  conversationId: string;
  speaker: string;
  text: string;
};

let server: Server | undefined;
let baseUrl = "";

async function startServer(
  overrides: Parameters<typeof createChatCompletionsRouter>[0]
) {
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => {
      server?.close((err) => (err ? reject(err) : resolve()));
    });
  }

  const app = express();
  app.use(express.json());
  app.use(createChatCompletionsRouter(overrides));

  server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve route test server address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 200
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for async side effect");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

after(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => {
      server?.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

describe("chat-completions route persistence", () => {
  it("persists customer and assistant transcripts for non-stream responses", async () => {
    const recordedMessages: RecordedMessage[] = [];
    const fetchBodies: Array<Record<string, unknown>> = [];

    await startServer({
      now: () => 1234,
      getSentiment: () => "neutral",
      analyzeSentiment: async () => "neutral",
      ensureConversation: async () => "conv_chat",
      recordMessage: async (conversationId, speaker, text) => {
        recordedMessages.push({ conversationId, speaker, text });
      },
      fetchImpl: async (_url, init) => {
        fetchBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion",
            created: 1234,
            model: "minimax-test",
            choices: [
              {
                message: {
                  role: "assistant",
                  content:
                    "<think>internal reasoning</think>Thanks for waiting. I found your order.",
                },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 6,
              total_tokens: 16,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      },
    });

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stream: false,
        call: { id: "call_chat" },
        metadata: {},
        messages: [{ role: "user", content: "Where is my order?" }],
      }),
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    assert.equal(
      body.choices[0]?.message.content,
      "Thanks for waiting. I found your order."
    );
    assert.deepEqual(recordedMessages, [
      {
        conversationId: "conv_chat",
        speaker: "customer",
        text: "Where is my order?",
      },
      {
        conversationId: "conv_chat",
        speaker: "agent",
        text: "Thanks for waiting. I found your order.",
      },
    ]);
    assert.equal(fetchBodies[0]?.stream, false);
  });

  it("persists sentiment changes when analysis differs from cached sentiment", async () => {
    const sentimentCache = new Map<string, string>([["call_sentiment", "neutral"]]);
    const sentimentUpdates: Array<{
      conversationId: string;
      previous: string;
      current: string;
    }> = [];

    await startServer({
      now: () => 5678,
      getSentiment: (callId) =>
        (sentimentCache.get(callId) as "neutral" | "frustrated" | "calm" | "satisfied") ??
        "neutral",
      setSentiment: (callId, sentiment) => {
        sentimentCache.set(callId, sentiment);
      },
      analyzeSentiment: async () => "frustrated",
      ensureConversation: async () => "conv_sentiment",
      recordMessage: async () => undefined,
      updateConversationSentiment: async (conversationId, previous, current) => {
        sentimentUpdates.push({ conversationId, previous, current });
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: { role: "assistant", content: "I can help with that." },
                finish_reason: "stop",
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        ),
    });

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stream: false,
        call: { id: "call_sentiment" },
        metadata: {},
        messages: [{ role: "user", content: "I'm really upset my package never came." }],
      }),
    });

    assert.equal(response.status, 200);
    await waitFor(() => sentimentUpdates.length === 1);
    assert.deepEqual(sentimentUpdates, [
      {
        conversationId: "conv_sentiment",
        previous: "neutral",
        current: "frustrated",
      },
    ]);
    assert.equal(sentimentCache.get("call_sentiment"), "frustrated");
  });
});
