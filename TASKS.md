# ShieldDesk AI — Build Tasks

Ordered by dependency. Each layer builds on the previous. Within a layer, tasks can be parallelized.

---

## PREREQUISITES: External Setup

Do these before writing any code.

### Prereq A: Gather all API credentials

Sign up for and obtain keys for every service:
- **MiniMax**: API key. Use `https://api.minimax.io/v1` as base URL with Bearer token auth. No Group ID required (OpenAI-compatible endpoint).
- **VAPI**: Public key (for browser SDK), private key (for server API), and assistant ID (created via setup script or dashboard).
- **Convex**: Run `npx convex dev` to create a project. Copy `CONVEX_URL` and `CONVEX_DEPLOY_KEY`.
- **Speechmatics**: API key from dashboard. The realtime API exchanges this for a per-session JWT.
- **Plivo**: Auth ID, auth token, and a purchased phone number (E.164). Set Answer URL to `https://PUBLIC_URL/plivo/answer`.
- **ElevenLabs**: API key + choose a Voice ID from the ElevenLabs voice library.
- **rtrvr.ai**: API key from rtrvr.ai dashboard.
- **ArmorIQ**: API key, User ID, and Agent ID. All three required.

### Prereq B: Tunnel setup

VAPI custom LLM endpoint and Plivo both require a public HTTPS URL.

- Install ngrok: `brew install ngrok/ngrok/ngrok`
- Start tunnel: `ngrok http 3000`
- Set `PUBLIC_URL=https://<subdomain>.ngrok.io` in `.env`
- Update VAPI assistant and Plivo number configuration with the new URL each restart (or use a stable domain)

### Prereq C: Register MCP server with ArmorIQ

ArmorIQ's `invoke()` routes to the MCP server via HTTP. Register it before Layer 2 testing:

1. Log into ArmorIQ dashboard → MCP Registry → Register Server
2. Register with URL pointing to your mcp-server (port 3001, path `/mcp`)
3. ArmorIQ will probe `tools/list` to validate. The MCP server must be running and reachable.

---

## Layer 0: Foundation

### 0.1 — Monorepo scaffold
- Initialize npm workspaces in root `package.json`
- Create directory structure: `apps/api-server/`, `apps/dashboard/`, `convex/`, `mcp-server/`, `packages/shared/`, `scripts/`, `eval/`
- Create `tsconfig.base.json` with strict mode, ES2022 target, NodeNext module
- Each workspace gets its own `package.json` and `tsconfig.json` extending base
- Create `.gitignore` (node_modules, .env, dist, .convex)
- Install shared dev deps: `typescript`, `zod`, `pino`
- **Verify**: `npm install` succeeds, `tsc --noEmit` passes

### 0.2 — Shared types (`packages/shared/`)
- Define TypeScript types + Zod schemas for:
  - Tool risk scores map (7 tools)
  - Decision function inputs/outputs (`PolicyInput`, `PolicyDecision`)
  - Sentiment enum + multiplier map
  - Trust level enum + ceiling map
  - MCP JSON-RPC request/response types
  - VAPI webhook payload types (chat completions request, tool-calls request)
  - ArmorIQ types (PlanCapture, IntentToken)
- Export everything from `packages/shared/src/index.ts`
- **Verify**: Imports resolve from other workspaces

### 0.3 — Convex schema + seed data
- Create `convex/schema.ts` with all 8 tables from PRD:
  - `customers` (indexed on phoneE164)
  - `orders` (indexed on orderNumber)
  - `tickets`
  - `conversations` (indexed on channelSessionId)
  - `transcripts`
  - `agentActions`
  - `conversationEvents`
  - `knowledgeDocuments` (vector index on embedding)
- Create seed mutation `convex/seed.ts`:
  - 4 demo customers (one per trust level: anonymous, authenticated, premium, VIP)
  - 5 demo orders (various statuses: processing, shipped, delivered, cancelled, refunded)
  - 3 demo knowledge documents (FAQ entries about shipping, returns, account management)
- Create basic queries: `customers:getByPhone`, `customers:getById`, `orders:getByNumber`, `conversations:list`, `agentActions:byConversation`
- Create basic mutations: `conversations:create`, `conversations:update`, `transcripts:add`, `agentActions:log`, `conversationEvents:add`
- **Verify**: `npx convex dev` deploys, seed data visible in Convex dashboard

### 0.4 — Dashboard skeleton (`apps/dashboard/`)
- Next.js 14 App Router with `ConvexProvider` wrapper
- Install `convex`
- Home page `/` — list active conversations from Convex (useQuery)
- Stub page `/conversations/[id]` — placeholder panels
- Basic layout: header with "ShieldDesk AI" title, sidebar nav
- Tailwind CSS for styling
- **Verify**: Dashboard loads at `localhost:3002`, shows data from Convex

### 0.5 — Config + env validation
- Create `apps/api-server/src/config.ts` — Zod schema validates all env vars at startup, fail fast
- Create `mcp-server/src/config.ts` — same pattern
- **Verify**: Server crashes with clear error message if required env var is missing

---

## Layer 1: VAPI Web Voice Channel

Primary demo channel. Get the API server, VAPI integration, and web widget working.

### 1.1 — API server scaffold (`apps/api-server/`)
- Express server with `pino` logging
- CORS enabled for dashboard origin
- Health check: `GET /health`
- Load config from validated env vars
- Initialize `ConvexHttpClient`
- **Verify**: Server starts on port 3000, health check returns 200

### 1.2 — Custom LLM endpoint (`POST /vapi/chat/completions`)
- Accept OpenAI-format chat completion request from VAPI
- Extract latest user message
- Query Convex for customer context (if session has a customer ID)
- Build system prompt with:
  - Agent persona ("You are ShieldDesk, an AI customer support agent...")
  - Available tools as function definitions (7 tools with inputSchema)
  - Governance rules ("Some actions may require approval based on policy...")
- Proxy to MiniMax M2.5 at `{MINIMAX_BASE_URL}/chat/completions`
- Return OpenAI-format response (may include `tool_calls`)
- Parse and validate MiniMax response with Zod
- **Verify**: `curl` with OpenAI-format body gets valid response

### 1.3 — Tool-calls webhook (`POST /vapi/tool-calls`)
- Accept VAPI tool-call webhook payload
- Extract tool name + arguments
- Log to Convex `agentActions` as "planned"
- **Stub**: Decision function always returns ALLOW
- **Stub**: Skip ArmorIQ, execute tool directly against Convex
- Return tool result to VAPI
- **Verify**: VAPI triggers a tool call (e.g., `order.lookup`), gets result, uses it in response

### 1.4 — VAPI assistant setup script
- Create `scripts/setup-vapi-assistant.ts`
- Uses VAPI private API key to create/update assistant:
  - Model: "custom" (points to custom LLM endpoint)
  - Custom LLM URL: `{PUBLIC_URL}/vapi/chat/completions`
  - Server URL: `{PUBLIC_URL}/vapi/tool-calls`
  - First message: "Hi, I'm ShieldDesk support. How can I help you today?"
  - Voice: ElevenLabs (configured in VAPI dashboard)
- Output: `VAPI_ASSISTANT_ID` to add to `.env`
- **Verify**: Assistant visible in VAPI dashboard with correct config

### 1.5 — VAPI web widget in dashboard
- Install `@vapi-ai/web` in dashboard
- Create `VapiWidget.tsx` component:
  - "Talk to Support" button
  - Uses `VAPI_PUBLIC_KEY` and `VAPI_ASSISTANT_ID`
  - Shows call status (connecting, active, ended)
  - Passes customer context via `assistantOverrides.metadata`
- Add widget to dashboard header or `/talk` page
- **Verify**: Click button, speak, agent responds with voice, tool calls visible in Convex

**This is the Layer 1 milestone: end-to-end web voice conversation with tool calling.**

---

## Layer 2: ArmorIQ Governance

Wire up the policy engine. After this layer, every tool call is governed.

### 2.1 — Decision function (`apps/api-server/src/policy/decision.ts`)
- Implement `evaluatePolicy(input: PolicyInput): PolicyDecision`
- Input: `{ confidence, riskScore, sentiment, trustLevel }`
- Logic from PRD:
  - `effectiveThreshold = trustCeiling[trustLevel] * sentimentMultiplier[sentiment]`
  - risk >= 0.95 → DENY
  - confidence < 0.70 → ESCALATE
  - risk < effectiveThreshold AND confidence >= 0.85 → ALLOW
  - Otherwise → ESCALATE
- Create `policy/risk-scores.ts` with the 7 tool risk scores
- Unit tests covering all edge cases:
  - Authenticated + frustrated + order.lookup → ALLOW (risk 0.05 < threshold 0.56)
  - Authenticated + frustrated + order.refund → ESCALATE (risk 0.60 > threshold 0.56)
  - VIP + frustrated + order.refund → ALLOW (risk 0.60 < threshold 1.19)
  - Any trust + any sentiment + account.delete → DENY (risk 1.00 >= 0.95)
  - Low confidence (0.55) on any tool → ESCALATE
- **Verify**: All tests pass

### 2.2 — MCP tool server (`mcp-server/`)
- Express server on port 3001
- JSON-RPC 2.0 handler at `POST /mcp`
- `initialize` method (handshake)
- `tools/list` — return manifests for 7 tools with inputSchema
- `tools/call` — dispatch to tool handlers:
  - `faq.search` → Convex vector search on knowledgeDocuments
  - `order.lookup` → Convex query on orders
  - `account.lookup` → Convex query on customers
  - `ticket.create` → Convex mutation
  - `ticket.escalate` → Convex mutation to update ticket status
  - `account.update` → Convex mutation
  - `order.refund` → Convex mutation to update order status
- Response: SSE (`text/event-stream`) with JSON-RPC response in data field
- **Verify**: `curl` to `localhost:3001/mcp` with `tools/list` returns all 7 tools

### 2.3 — ArmorIQ executor (`apps/api-server/src/policy/executor.ts`)
- Install ArmorIQ SDK
- Implement `executeWithGovernance(toolName, toolArgs, policyInput)`:
  1. Run decision function → get decision
  2. DENY → log to Convex, return denial message
  3. ESCALATE → log to Convex, return escalation message
  4. ALLOW:
     a. `capturePlan(llm, prompt, plan, metadata?)` — positional args
     b. `getIntentToken(planCapture, policy?, 300)` — 300s validity for support conversations
     c. `invoke(mcp, action, intentToken, params?)` — positional args
     d. Log result to Convex with ArmorIQ verification data
- If ArmorIQ throws → fail closed (deny + log)
- **Verify**: End-to-end: policy check → ArmorIQ sign → MCP execute → result

### 2.4 — Wire governance into tool-calls webhook
- Replace stub in 1.3 with real `executeWithGovernance`
- Extract confidence from MiniMax response
- Look up trust level from conversation's customer
- Get sentiment from conversation state
- Pass through decision function → ArmorIQ → MCP
- Return appropriate response to VAPI based on decision
- **Verify**: Ask for order lookup as authenticated user → ALLOW. Ask for refund as authenticated user → ESCALATE. Verify policy decision badges in Convex `agentActions`.

**This is the Layer 2 milestone: every tool call is policy-checked and cryptographically verified.**

---

## Layer 3: Convex RAG + Knowledge Base

### 3.1 — RAG component setup
- Install `@convex-dev/rag` in Convex project
- Configure vector index on `knowledgeDocuments` table (1536 dimensions for MiniMax embo-01)
- Create embedding function: calls MiniMax `POST /v1/embeddings` with model `embo-01`
- Create `convex/knowledge.ts`:
  - `knowledge:ingest` mutation — takes text + metadata, chunks (512 tokens, 64-token overlap), embeds, stores
  - `knowledge:search` query — takes query string, embeds, vector search, returns top-5 chunks
- **Verify**: Ingest a test document, search for it, get relevant results

### 3.2 — rtrvr.ai scraper
- Create `scripts/scrape-knowledge.ts`
- Config: list of URLs to scrape (demo company FAQ, help docs)
- Call rtrvr.ai API: `POST https://api.rtrvr.ai/v1/scrape` with target URL
- Parse response: extract cleaned text
- Chunk content (512 tokens, 64-token overlap)
- Call `knowledge:ingest` for each chunk
- Content hash dedup — skip already-indexed chunks
- **Verify**: Run against a real URL, see documents in Convex dashboard

### 3.3 — Inject RAG into LLM endpoint
- In `POST /vapi/chat/completions`:
  1. Extract latest user message
  2. Call `knowledge:search` with the message
  3. Format top results as context block in system prompt
  4. MiniMax M2.5 answers grounded in retrieved knowledge
- Also wire `faq.search` tool to the same vector search
- **Verify**: Ask agent about something in the scraped docs, get accurate answer

**Layer 3 milestone: agent answers from real knowledge base, not just LLM training data.**

---

## Layer 4: Plivo Phone Channel + Speechmatics

Secondary demo channel. Real phone calls.

### 4.1 — Plivo Answer URL (`POST /plivo/answer`)
- Return `<Stream>` XML:
  - `bidirectional="true"`, `audioTrack="inbound"`, `keepCallAlive="true"`
  - `contentType="audio/x-mulaw;rate=8000"`
  - WebSocket URL: `wss://{PUBLIC_URL}/plivo/ws`
- Validate Plivo HMAC-SHA256 signature (`X-Plivo-Signature`)
- Create conversation in Convex with `channelType: "plivo_phone"`
- Look up caller by `From` E.164 → resolve trust level
- **Verify**: Configure Plivo number, call it, see stream start

### 4.2 — WebSocket gateway (`/plivo/ws`)
- Handle Plivo stream events: `start`, `media`, `dtmf`, WebSocket close
- On `start`: store streamId, initialize Speechmatics connection
- On `media`: decode base64 → forward raw mulaw to Speechmatics
- On close: finalize conversation
- Implement `playAudio` (base64 mulaw → Plivo, max 64KB), `clearAudio` (barge-in)
- **Verify**: Call phone, speak, see audio in logs

### 4.3 — Speechmatics STT
- Connect to Speechmatics Realtime WebSocket
- Config: `audio_format: { type: "raw", encoding: "mulaw", sample_rate: 8000 }`
- Handle: `AddPartialTranscript`, `AddTranscript`, `EndOfUtterance`
- Turn detection: buffer finals, close on `EndOfUtterance`
- Extract sentiment from Speechmatics analysis
- Store transcripts in Convex
- **Critical**: Set `conversation_config.end_of_utterance_silence_trigger: 0.5` — without it, `EndOfUtterance` never fires
- **Verify**: Speak into phone, see final transcripts in Convex

### 4.4 — ElevenLabs TTS
- Call ElevenLabs streaming TTS with `output_format=ulaw_8000`
- Stream chunks → base64 encode → `playAudio` to Plivo
- Barge-in: if new `media` during playback, send `clearAudio`
- **Verify**: Agent speaks back through phone

### 4.5 — Agent orchestrator for phone channel
- On turn complete:
  1. Send text to MiniMax M2.5 (same prompt as VAPI endpoint)
  2. If tool calls: run through `executeWithGovernance`
  3. Generate response text
  4. Send to ElevenLabs TTS → Plivo playAudio
- Maintain conversation history in Convex
- **Verify**: Full phone conversation with governed tool execution

### 4.6 — SMS post-call summary
- On conversation end (Plivo close):
  1. Generate summary via MiniMax M2.5
  2. Send SMS via Plivo API
  3. Store summary in conversation record
- **Verify**: End call, receive SMS summary

**Layer 4 milestone: full phone channel with STT, TTS, governance, and SMS.**

---

## Layer 5: Dashboard Polish

### 5.1 — Conversation detail page (`/conversations/[id]`)
- Panel 1: Conversation card (customer, channel, trust level badge, sentiment, status, duration)
- Panel 2: Live transcript (scrolling, speaker labels, auto-scroll)
- Panel 3: Agent action log (tool name, policy badge green/red/yellow, confidence/risk/threshold numbers, ArmorIQ verification)
- Panel 4: Timeline (chronological events with actor badges)
- All panels: Convex `useQuery` for real-time updates
- **Verify**: Start a call, watch all panels update live

### 5.2 — Conversation list page (`/`)
- Cards: customer name, channel icon (web/phone), status, trust level, sentiment, last activity
- Sort by most recent
- Click → detail page
- Real-time: new conversations appear automatically
- **Verify**: Multiple conversations appear and update

### 5.3 — Policy decision visualization
- "Decision Surface" mini-panel on conversation detail:
  - Shows formula: `effectiveThreshold = ceiling × sentiment`
  - Shows current session values
  - Visual indicator of where each tool call fell on allow/deny spectrum
- Makes governance story compelling for judges
- **Verify**: Can explain any policy decision from the dashboard

---

## Layer 6: Demo Hardening

### 6.1 — Seed data reset script
- `scripts/reset-demo.ts` — clears conversations, actions, events, re-seeds customers and orders
- Run before each demo
- **Verify**: Runs in < 5 seconds, clean state

### 6.2 — Error handling sweep
- No unhandled promise rejections crash the server
- WebSocket disconnects handled gracefully
- ArmorIQ timeout doesn't hang responses
- MiniMax timeout falls back to "could you repeat that?"
- Structured error logging everywhere
- **Verify**: Kill and restart services — system recovers

### 6.3 — Demo script
Sequence for live presentation:
1. Show dashboard (empty state)
2. Click "Talk to Support" — ask about an order → ALLOW (low risk)
3. Ask for a refund → ESCALATE (authenticated user, high risk)
4. Show dashboard — point out policy decision badges, ArmorIQ verification
5. Switch to VIP customer — refund now ALLOWED
6. Show audit trail — every decision is explainable
- **Verify**: Full demo runs in under 3 minutes

### 6.4 — Regression eval
- Write 10-15 golden test cases in `eval/golden/cases.jsonl`
- Implement eval runner `scripts/run-eval.ts`:
  - Send each case through MiniMax intent extraction
  - Check action match, field extraction, confidence calibration
  - Run policy decision check
  - Output pass/fail + aggregate metrics
- **Verify**: > 90% action match, 0% false acceptance on high-risk tools
