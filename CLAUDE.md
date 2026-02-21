# ShieldDesk AI — Project Context for Claude

## What this project is

Governance-first voice customer support agent. Customers talk to an AI agent that can look up orders, issue refunds, create tickets, and update accounts — but every action is cryptographically verified by ArmorIQ before execution. The decision function evaluates `f(confidence, risk, sentiment, trust_level)` on every tool call. Built for the Return of the Agents hackathon (Feb 21, 2026).

Two voice channels:
- **VAPI** (primary): Web widget embedded in the dashboard. Judges click a button and talk to the agent in-browser.
- **Plivo** (secondary): Phone number. Uses Speechmatics STT + ElevenLabs TTS. Post-call SMS summary.

## Tech stack

- **Runtime**: Node.js 20+ / TypeScript (strict mode)
- **Package manager**: npm with workspaces
- **HTTP framework**: Express (api-server and mcp-server)
- **WebSockets**: `ws` library (Plivo stream protocol, Speechmatics realtime)
- **Validation**: Zod for all external inputs (webhooks, LLM outputs, API payloads)
- **Real-time state**: Convex (managed backend — schema in `convex/schema.ts`)
- **RAG**: Convex vector search (`@convex-dev/rag`) + MiniMax `embo-01` embeddings
- **LLM**: MiniMax M2.5 via OpenAI-compatible API (`https://api.minimax.io/v1`)
- **Voice orchestration**: VAPI (custom LLM endpoint + tool-calls webhook)
- **Policy enforcement**: ArmorIQ SDK (`@anthropic/armoriq` or `@armoriq/sdk`)
- **Telephony**: Plivo Voice + Audio Streaming (bidirectional WebSocket)
- **ASR**: Speechmatics Realtime (WebSocket streaming) — phone channel only
- **TTS**: ElevenLabs Flash v2.5 (`output_format=ulaw_8000`) — phone channel only
- **Sentiment**: Speechmatics post-utterance sentiment analysis
- **Knowledge scraping**: rtrvr.ai API
- **SMS**: Plivo SMS API (post-call summaries)
- **Dashboard**: Next.js 14 (App Router) + Convex React client
- **Deployment**: Docker + docker-compose for local dev

## Monorepo layout

```
apps/api-server/       — Express server: VAPI webhooks, Plivo webhooks, agent orchestrator, policy executor
apps/dashboard/        — Next.js frontend with Convex real-time subscriptions + VAPI web widget
convex/                — Convex schema + queries + mutations + RAG (deployed to Convex cloud)
mcp-server/            — Customer support tool server (JSON-RPC 2.0 + SSE, called by ArmorIQ)
packages/shared/       — Shared TypeScript types across services
scripts/               — Setup scripts (VAPI assistant creation, seed data, rtrvr.ai scraper)
eval/                  — Regression harness for intent extraction + policy decisions
```

## Critical rules

### Audio format (Plivo channel only)
ALL audio in the Plivo voice pipeline is **mulaw 8kHz**. No exceptions. Plivo streams it, Speechmatics accepts it, ElevenLabs outputs it (request `output_format=ulaw_8000`), Plivo plays it back. If you introduce PCM or MP3 anywhere in the pipeline, the caller hears static.

### Policy enforcement
Every agent action goes through the decision function (`policy/decision.ts`) THEN through ArmorIQ. The decision function computes `f(confidence, risk, sentiment, trust_level)` → allow/deny/escalate. There is no bypass path. If you add a new tool, you must add its risk score to `policy/risk-scores.ts`.

### Decision function inputs
- **Confidence** (0-1): MiniMax intent extraction confidence
- **Risk score** (0-1): Pre-assigned per tool (order.lookup=0.05, order.refund=0.60, account.delete=1.00)
- **Sentiment modifier**: frustrated=1.4x, neutral=1.0x, satisfied=0.9x, calm=0.8x (modifies threshold)
- **Trust level** (1-4): Anonymous(1)=0.10 ceiling, Authenticated(2)=0.40, Premium(3)=0.65, VIP(4)=0.85

### ArmorIQ flow
The sequence is always: `capturePlan(llm, prompt, plan, metadata?)` → `getIntentToken(planCapture, policy?, validitySeconds?)` → `invoke(mcp, action, intentToken, params?)`. All methods use **positional arguments**, not option objects. Every invocation includes CSRG headers (`X-API-Key`, `X-CSRG-Path`, `X-CSRG-Value-Digest`, `X-CSRG-Proof`) — the SDK handles this automatically. The MCP server should respond with SSE (`text/event-stream`) for streaming, though JSON is also valid per the MCP spec. Default token expiry is 60 seconds — use 300s for support conversations.

### VAPI integration
- **Custom LLM endpoint** (`POST /vapi/chat/completions`): VAPI sends OpenAI-format messages. We proxy to MiniMax M2.5 with RAG context injected into the system prompt. Return OpenAI-format response with optional `tool_calls`.
- **Tool-calls webhook** (`POST /vapi/tool-calls`): When VAPI detects tool calls in the LLM response, it sends them here. We run ArmorIQ governance, execute via MCP, return results. VAPI feeds results back to the LLM.
- Never call MiniMax directly from the dashboard — always through the API server.

### Convex patterns
- Use `ConvexHttpClient` from the api-server and mcp-server (Node.js backend calls)
- Use `useQuery`/`useMutation` hooks in the dashboard (React client with auto-subscriptions)
- Every mutation that modifies state should also write to the `conversationEvents` table for audit
- All Convex functions follow the naming: `tableName:functionName` (e.g., `tickets:create`, `agentActions:byConversation`)

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

## How to run locally

```bash
# Install dependencies
npm install

# Start Convex dev server (deploys schema, runs functions locally)
cd convex && npx convex dev

# Start MCP tool server
cd mcp-server && npm run dev    # Runs on port 3001

# Start API server
cd apps/api-server && npm run dev    # Runs on port 3000

# Start dashboard
cd apps/dashboard && npm run dev    # Runs on port 3002
```

For the Plivo phone channel, you need a tunnel (ngrok) to expose the API server for Answer URL and WebSocket connections. For VAPI, configure the custom LLM endpoint URL in the VAPI dashboard.

## Environment variables

See `.env.example` at project root. Required:
- `MINIMAX_API_KEY`, `MINIMAX_BASE_URL`, `MINIMAX_MODEL`
- `VAPI_PUBLIC_KEY`, `VAPI_PRIVATE_KEY`, `VAPI_ASSISTANT_ID`
- `CONVEX_URL`, `CONVEX_DEPLOY_KEY`, `NEXT_PUBLIC_CONVEX_URL`
- `SPEECHMATICS_API_KEY`
- `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN`, `PLIVO_PHONE_NUMBER`
- `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`
- `RTRVR_API_KEY`
- `ARMORIQ_API_KEY`, `ARMORIQ_USER_ID`, `ARMORIQ_AGENT_ID`
- `PORT`, `MCP_SERVER_URL`, `PUBLIC_URL`

## Key files you'll modify most

| File | What it does | When to modify |
|---|---|---|
| `convex/schema.ts` | Data model for all tables | Adding new fields or tables |
| `apps/api-server/src/vapi/chat-completions.ts` | Custom LLM endpoint for VAPI | Changing LLM behavior, RAG injection |
| `apps/api-server/src/vapi/tool-calls.ts` | Tool-calls webhook handler | Changing how tool calls are governed |
| `apps/api-server/src/agent/intent.ts` | MiniMax prompt + Zod schema for intent extraction | Changing what the agent understands |
| `apps/api-server/src/policy/decision.ts` | The decision function f(confidence, risk, sentiment, trust) | Tuning policy behavior |
| `apps/api-server/src/policy/risk-scores.ts` | Tool name → risk score map | Adding new tools |
| `mcp-server/src/tools/registry.ts` | MCP tool manifests | Adding new tools |
| `apps/api-server/src/plivo/gateway.ts` | Plivo WebSocket handler | Changing phone audio pipeline |
| `apps/dashboard/src/components/VapiWidget.tsx` | VAPI web widget component | Changing voice UI |
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
ArmorIQ capture_plan: https://docs.armoriq.ai/docs/core-methods/capture-plan
ArmorIQ get_intent_token: https://docs.armoriq.ai/docs/core-methods/get-intent-token
ArmorIQ invoke: https://docs.armoriq.ai/docs/core-methods/invoke
ArmorIQ MCP Format: https://docs.armoriq.ai/docs/mcp-directory/mcp-format
Plivo Audio Streaming: https://www.plivo.com/docs/audio-streaming/
Plivo <Stream> XML: https://www.plivo.com/docs/voice/xml/stream
Speechmatics Realtime API: https://docs.speechmatics.com/api-ref/transcribe-realtime
ElevenLabs Stream TTS: https://elevenlabs.io/docs/api-reference/text-to-speech/stream
rtrvr.ai API: https://docs.rtrvr.ai
```
