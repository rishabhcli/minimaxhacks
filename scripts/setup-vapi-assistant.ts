/**
 * scripts/setup-vapi-assistant.ts
 *
 * Creates a VAPI assistant configured with our custom LLM endpoint
 * and tool-calls webhook. Prints the assistant ID to add to .env.
 *
 * Usage:
 *   npx tsx scripts/setup-vapi-assistant.ts
 */

import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dotenvDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dotenvDir, "../.env") });

// ── Config ──

const VAPI_PRIVATE_KEY = process.env.VAPI_PRIVATE_KEY;
const PUBLIC_URL = process.env.PUBLIC_URL || "http://localhost:3000";

if (!VAPI_PRIVATE_KEY) {
  console.error("Missing VAPI_PRIVATE_KEY in .env");
  process.exit(1);
}

// ── Create assistant ──

async function main(): Promise<void> {
  console.log("ShieldDesk AI — VAPI Assistant Setup");
  console.log("=====================================\n");
  console.log(`Custom LLM endpoint: ${PUBLIC_URL}/vapi/chat/completions`);
  console.log(`Tool-calls webhook:  ${PUBLIC_URL}/vapi/tool-calls\n`);

  const assistantConfig = {
    name: "ShieldDesk Support Agent",
    model: {
      provider: "custom-llm",
      url: `${PUBLIC_URL}/vapi/chat/completions`,
      model: "MiniMax-M2.5",
    },
    voice: {
      provider: "11labs",
      voiceId: process.env.ELEVENLABS_VOICE_ID || "hpp4J3VqNfWAUOO0d1Us",
      stability: 0.5,
      similarityBoost: 0.75,
    },
    firstMessage:
      "Hi, welcome to ShieldDesk support! How can I help you today?",
    serverUrl: `${PUBLIC_URL}/vapi/tool-calls`,
    endCallFunctionEnabled: false,
    transcriber: {
      provider: "deepgram",
      model: "nova-2",
      language: "en",
    },
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 600,
    backgroundSound: "office",
    backchannelingEnabled: true,
    metadata: {
      project: "shielddesk-ai",
      version: "0.1.0",
    },
  };

  console.log("Creating assistant...\n");

  const resp = await fetch("https://api.vapi.ai/assistant", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${VAPI_PRIVATE_KEY}`,
    },
    body: JSON.stringify(assistantConfig),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    console.error(`VAPI API error (${resp.status}):`);
    console.error(errorText);
    process.exit(1);
  }

  const assistant = (await resp.json()) as { id: string; name: string };

  console.log("Assistant created successfully!");
  console.log(`  Name: ${assistant.name}`);
  console.log(`  ID:   ${assistant.id}`);
  console.log();
  console.log("Add this to your .env file:");
  console.log(`  VAPI_ASSISTANT_ID=${assistant.id}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
