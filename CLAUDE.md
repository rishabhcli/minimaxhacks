# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# ShieldDesk AI — Project Context for Claude

## Common commands

```bash
# Install all workspace dependencies
npm install

# Run services (from project root)
npm run dev:api          # API server (port 3000) — tsx watch
npm run dev:mcp          # MCP tool server (port 3001) — tsx watch
npm run dev:dashboard    # Next.js dashboard (port 3002)
npm run dev:convex       # Convex dev sync

# Deploy Convex functions
CONVEX_DEPLOYMENT='dev:diligent-lynx-844' npx convex dev --once

# Run policy unit tests (Node.js built-in test runner, not Jest)
node --import tsx --test apps/api-server/tests/**/*.test.ts

# Run eval harness (10 golden cases)
npm run eval

# Typecheck individual workspaces
npm run typecheck --workspace=apps/api-server
npm run typecheck --workspace=mcp-server

# Build
npm run build --workspace=apps/api-server
npm run build --workspace=mcp-server
npm run build --workspace=apps/dashboard

# Seed demo data
npm run seed
```

## What this project is

Governance-first voice customer support agent. Customers talk to an AI agent that can look up orders, issue refunds, create tickets, and update accounts — but every action is gated by a policy decision function and optionally verified by ArmorIQ before execution. The decision function evaluates `f(confidence, risk, sentiment, trust_level)` on every tool call. Built for the Return of the Agents hackathon (Feb 21, 2026).

Two voice channels:
- **VAPI** (primary): Web widget embedded in the dashboard. Judges click a button and talk to the agent in-browser.
- **Plivo** (secondary): Phone number (+1 510 529 3314). Uses Speechmatics STT + ElevenLabs TTS via bidirectional WebSocket.

## Tech stack

- **Runtime**: Node.js 20+ / TypeScript (strict mode)
- **Package manager**: npm with workspaces
- **HTTP framework**: Express (api-server and mcp-server)
- **WebSockets**: `ws` library (Plivo stream protocol, Speechmatics realtime)
- **Validation**: Zod for all external inputs (webhooks, LLM outputs, API payloads)
- **Real-time state**: Convex (managed backend — schema in `convex/schema.ts`)
- **RAG**: Convex vector search + MiniMax `embo-01` embeddings (knowledgeDocuments table with 1536-dim vector index)
- **LLM**: MiniMax M2.5 via OpenAI-compatible API (`https://api.minimax.io/v1`)
- **Voice orchestration**: VAPI (custom LLM endpoint + tool-calls webhook)
- **Policy enforcement**: Decision function in `policy/decision.ts` + ArmorIQ SDK for cryptographic verification
- **Telephony**: Plivo Voice + Audio Streaming (bidirectional WebSocket, mulaw 8kHz)
- **ASR**: Speechmatics Realtime (WebSocket streaming) — phone channel only
- **TTS**: ElevenLabs Flash v2.5 (`output_format=ulaw_8000`) — phone channel only
- **Knowledge scraping**: rtrvr.ai API
- **Dashboard**: Next.js 14 (App Router) + Convex React client
- **Env loading**: `dotenv` — all services load from root `.env` file

## Monorepo layout

```
apps/api-server/       — Express server: VAPI webhooks, Plivo webhooks, policy executor
  src/config.ts        — Zod-validated env vars, loads root .env via dotenv
  src/index.ts         — Express + WebSocket upgrade for /plivo/ws
  src/vapi/            — chat-completions.ts (custom LLM proxy), tool-calls.ts (governance webhook), tool-definitions.ts
  src/policy/          — decision.ts (the decision function), risk-scores.ts, executor.ts (governance orchestrator)
  src/plivo/           — answer.ts (Answer URL XML), gateway.ts (WebSocket handler), speechmatics.ts, elevenlabs.ts
  tests/               — policy.test.ts (14 unit tests)
apps/dashboard/        — Next.js 14 frontend with Convex real-time subscriptions + VAPI web widget
  src/app/             — page.tsx (conversation list), conversations/[id]/page.tsx (4-panel detail), talk/page.tsx
  src/components/      — VapiWidget.tsx, ConvexClientProvider.tsx
  src/lib/             — api.ts (anyApi bridge), convex.ts (ConvexReactClient)
  next.config.js       — Loads root .env, exposes VAPI keys as NEXT_PUBLIC_*
convex/                — Convex schema + queries + mutations (deployed to Convex cloud)
  schema.ts            — 8 tables: customers, orders, tickets, conversations, transcripts, agentActions, conversationEvents, knowledgeDocuments
  _generated/          — Auto-generated types (gitignored, created by `npx convex dev`)
  *.ts                 — Query/mutation functions per table (customers.ts, orders.ts, etc.)
mcp-server/            — Customer support tool server (JSON-RPC 2.0 + SSE)
  src/tools/           — registry.ts (8 tool manifests), handlers.ts (Zod-validated handlers)
  src/jsonrpc.ts       — JSON-RPC 2.0 dispatcher (initialize, tools/list, tools/call)
packages/shared/       — Shared TypeScript types (Zod schemas for policy, MCP, VAPI, ArmorIQ, Convex enums)
scripts/               — Setup and seed scripts
  setup-vapi-assistant.ts — Creates VAPI assistant via API with custom LLM endpoint
  seed-data.ts         — Seeds 4 customers, 5 orders, 3 knowledge docs into Convex
  scrape-knowledge.ts  — rtrvr.ai scraper for RAG knowledge base
eval/                  — Regression harness for policy decisions
  run-eval.ts          — Runs 10 golden cases, checks policy pass rate >= 90%, 0 false acceptances on high-risk
  golden/cases.jsonl   — 10 test cases covering all decision paths
```

## Critical rules

### Audio format (Plivo channel only)
ALL audio in the Plivo voice pipeline is **mulaw 8kHz**. No exceptions. Plivo streams it, Speechmatics accepts it, ElevenLabs outputs it (request `output_format=ulaw_8000`), Plivo plays it back. If you introduce PCM or MP3 anywhere in the pipeline, the caller hears static.

### Policy enforcement
Every agent action goes through the decision function (`policy/decision.ts`) THEN optionally through ArmorIQ. The decision function computes `f(confidence, risk, sentiment, trust_level)` → allow/deny/escalate. There is no bypass path. If you add a new tool, you must add its risk score to `policy/risk-scores.ts` AND add the tool manifest to `mcp-server/src/tools/registry.ts`.

### Decision function logic
```
effectiveThreshold = TRUST_CEILINGS[trustLevel] * SENTIMENT_MULTIPLIERS[sentiment]
- If risk >= 0.95 → DENY always (destructive actions)
- If confidence < 0.70 → ESCALATE always (agent unsure)
- If risk < effectiveThreshold AND confidence >= 0.85 → ALLOW
- Otherwise → ESCALATE
```

### Decision function inputs
- **Confidence** (0-1): MiniMax intent extraction confidence
- **Risk score** (0-1): Pre-assigned per tool (faq.search=0.02, order.lookup=0.05, account.lookup=0.08, ticket.create=0.10, ticket.escalate=0.15, account.update=0.40, order.refund=0.60, account.delete=1.00)
- **Sentiment modifier**: frustrated=1.4x, neutral=1.0x, satisfied=0.9x, calm=0.8x (modifies threshold)
- **Trust level** (1-4): Anonymous(1)=0.10 ceiling, Authenticated(2)=0.40, Premium(3)=0.65, VIP(4)=0.85

### ArmorIQ flow
The sequence is always: `capturePlan(llm, prompt, plan, metadata?)` → `getIntentToken(planCapture, policy?, validitySeconds?)` → `invoke(mcp, action, intentToken, params?)`. All methods use **positional arguments**, not option objects. If ArmorIQ keys are empty, the executor falls back gracefully (policy engine still runs, crypto signing is skipped). Default token expiry is 300s for support conversations.

### VAPI integration
- **Custom LLM endpoint** (`POST /vapi/chat/completions`): VAPI sends OpenAI-format messages. We proxy to MiniMax M2.5 with system prompt + tool definitions. Return OpenAI-format response with optional `tool_calls`. On MiniMax failure, return a safe "could you repeat?" fallback.
- **Tool-calls webhook** (`POST /vapi/tool-calls`): When VAPI detects tool calls in the LLM response, it sends them here. We run policy governance → execute via MCP → return results. VAPI feeds results back to the LLM.
- **VAPI Assistant**: Created via `scripts/setup-vapi-assistant.ts`. Points custom LLM and serverUrl to the ngrok public URL.
- Never call MiniMax directly from the dashboard — always through the API server.

### Convex patterns
- Use `ConvexHttpClient` from the api-server and mcp-server (Node.js backend calls)
- Use `useQuery`/`useMutation` hooks in the dashboard (React client with auto-subscriptions)
- Use `anyApi` from `convex/server` instead of codegen imports (`api` from `convex/_generated/api`) — this avoids requiring `npx convex dev` for TypeScript compilation
- Every mutation that modifies state should also write to the `conversationEvents` table for audit
- All Convex functions follow the naming: `tableName:functionName` (e.g., `tickets:create`, `agentActions:byConversation`)
- `convex/_generated/` is auto-generated and gitignored — never commit it
- Deploy functions with: `CONVEX_DEPLOYMENT='dev:diligent-lynx-844' npx convex dev --once` from project root

### MiniMax output validation
MiniMax output is non-deterministic. ALWAYS parse with Zod. If parsing fails, the agent says "I didn't catch that, could you repeat?" — never crash, never execute with partial data.

### Idempotency
- Plivo callbacks can duplicate. Use `CallUUID` as idempotency key for call creation.
- VAPI webhooks can duplicate. Use message ID as idempotency key.
- Tool calls use `hash(conversationId, stepAction, attemptNumber)` as idempotency key.
- Check `agentActions` by idempotency key before executing.

### Turn detection (Plivo channel)
Do NOT act on partial transcripts. Wait for Speechmatics `EndOfUtterance` to close a turn, then process the accumulated text as a complete user utterance.

## Coding conventions

- TypeScript strict mode everywhere
- Zod schemas define the contract; infer types from schemas (`z.infer<typeof Schema>`)
- Use `pino` for structured logging; always include `conversationId` and `customerId` in log context
- Error handling: catch at boundaries, log structured errors, never let exceptions crash the WebSocket connection
- No `any` types except for Convex `v.any()` fields that genuinely accept arbitrary payloads
- Express route handlers use Zod for request body validation
- Environment variables validated at startup with Zod in `config.ts` — fail fast if missing
- All services load env from root `.env` via `dotenv` with relative path resolution

## How to run locally

```bash
# 1. Install dependencies
npm install

# 2. Deploy Convex functions (from project root)
CONVEX_DEPLOYMENT='dev:diligent-lynx-844' npx convex dev --once

# 3. Seed demo data
npx tsx scripts/seed-data.ts

# 4. Start ngrok tunnel (needed for VAPI and Plivo callbacks)
ngrok http 3000
# Update PUBLIC_URL in .env with the ngrok https URL

# 5. Create VAPI assistant (first time only)
npx tsx scripts/setup-vapi-assistant.ts
# Add the assistant ID to .env as VAPI_ASSISTANT_ID

# 6. Start MCP tool server
npx tsx mcp-server/src/index.ts    # Port 3001

# 7. Start API server
npx tsx apps/api-server/src/index.ts    # Port 3000

# 8. Start dashboard
cd apps/dashboard && npm run dev    # Port 3002

# 9. Open http://localhost:3002 and click "Talk to Support"
```

## Environment variables

All env vars live in `.env` at project root. All services load it via `dotenv`.

**Required for web demo (VAPI channel):**
- `MINIMAX_API_KEY`, `MINIMAX_BASE_URL`, `MINIMAX_MODEL`
- `VAPI_PUBLIC_KEY`, `VAPI_PRIVATE_KEY`, `VAPI_ASSISTANT_ID`
- `CONVEX_URL`, `NEXT_PUBLIC_CONVEX_URL`
- `PORT`, `MCP_SERVER_URL`, `PUBLIC_URL` (ngrok https URL)

**Required for phone channel (Plivo):**
- `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN`, `PLIVO_PHONE_NUMBER`
- `SPEECHMATICS_API_KEY`
- `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`

**Optional (graceful fallback if empty):**
- `ARMORIQ_API_KEY`, `ARMORIQ_USER_ID`, `ARMORIQ_AGENT_ID` — crypto governance layer
- `RTRVR_API_KEY` — knowledge scraping
- `CONVEX_DEPLOY_KEY` — for `npx convex deploy` (production)

## Eval harness

Run with `npx tsx eval/run-eval.ts` from project root. Passes when:
- Policy pass rate >= 90% (currently 92.3%)
- Zero false acceptances on high-risk tools (risk >= 0.60)
- 10 golden cases covering: allow, deny, escalate, low confidence, frustrated sentiment, VIP trust, anonymous trust, destructive actions

## Key files you'll modify most

| File | What it does | When to modify |
|---|---|---|
| `convex/schema.ts` | Data model for all 8 tables | Adding new fields or tables |
| `apps/api-server/src/vapi/chat-completions.ts` | Custom LLM endpoint for VAPI | Changing LLM behavior, RAG injection |
| `apps/api-server/src/vapi/tool-calls.ts` | Tool-calls webhook handler | Changing how tool calls are governed |
| `apps/api-server/src/vapi/tool-definitions.ts` | OpenAI-format tool definitions for MiniMax | Adding new tools |
| `apps/api-server/src/policy/decision.ts` | The decision function f(confidence, risk, sentiment, trust) | Tuning policy behavior |
| `apps/api-server/src/policy/risk-scores.ts` | Tool name → risk score map | Adding new tools |
| `apps/api-server/src/policy/executor.ts` | Governance orchestrator (decision → ArmorIQ → MCP) | Changing execution flow |
| `mcp-server/src/tools/registry.ts` | MCP tool manifests (8 tools) | Adding new tools |
| `mcp-server/src/tools/handlers.ts` | Tool execution handlers with Zod validation | Adding new tool logic |
| `apps/api-server/src/plivo/gateway.ts` | Plivo WebSocket handler | Changing phone audio pipeline |
| `apps/dashboard/src/components/VapiWidget.tsx` | VAPI web widget component | Changing voice UI |
| `apps/dashboard/src/app/conversations/[id]/page.tsx` | 4-panel conversation detail view | Changing dashboard UI |
| `scripts/scrape-knowledge.ts` | rtrvr.ai scraper for RAG docs | Adding new knowledge sources |
| `eval/golden/cases.jsonl` | Regression test cases | After every behavioral change |

## External API docs

```
MiniMax API: https://www.minimax.io/platform
MiniMax OpenAI-compat: https://platform.minimaxi.com/document/OpenAI%20compatibility
VAPI Custom LLM: https://docs.vapi.ai/custom-llm
VAPI Tool Calls: https://docs.vapi.ai/tool-calling
Convex Schemas: https://docs.convex.dev/database/schemas
Convex Node Client: https://docs.convex.dev/client/javascript/node
Convex Vector Search: https://docs.convex.dev/search/vector-search
ArmorIQ Configuration: https://docs.armoriq.ai/docs/configuration
ArmorIQ capture_plan: https://docs.armoriq.ai/docs/core-methods/capture-plan
ArmorIQ get_intent_token: https://docs.armoriq.ai/docs/core-methods/get-intent-token
ArmorIQ invoke: https://docs.armoriq.ai/docs/core-methods/invoke
Plivo Audio Streaming: https://www.plivo.com/docs/audio-streaming/
Plivo <Stream> XML: https://www.plivo.com/docs/voice/xml/stream
Speechmatics Realtime API: https://docs.speechmatics.com/api-ref/transcribe-realtime
ElevenLabs Stream TTS: https://elevenlabs.io/docs/api-reference/text-to-speech/stream
rtrvr.ai API: https://docs.rtrvr.ai
```
