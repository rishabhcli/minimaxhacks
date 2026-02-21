# PRD: ShieldDesk AI

## Problem

AI customer support agents can answer questions. That's table stakes. But customers don't just want answers — they want the agent to _do things_: refund my order, update my email, escalate to a manager, cancel my subscription.

Today's voice AI products (Bland, Retell, Air AI, Sierra) handle conversations well but treat actions as an afterthought — if they can act at all, there's no governance. An LLM that can process a $500 refund with no audit trail, no policy check, no confidence gate? No enterprise will deploy it.

So AI support agents stay stuck as expensive FAQ bots.

## Solution

A voice customer support agent where every action is cryptographically governed. The agent can look up orders, issue refunds, create tickets, update accounts — but each action passes through a decision function that evaluates confidence, risk, customer sentiment, and trust level before allowing execution. ArmorIQ signs every approved action with cryptographic proof, creating an immutable audit trail.

Two channels:
- **Web widget** (VAPI) — primary demo. Judges click a button, talk to the agent in-browser.
- **Phone** (Plivo) — secondary. Real phone number with Speechmatics STT + ElevenLabs TTS.

## Core user flow

1. Customer opens the web dashboard and clicks "Talk to Support" (or calls the phone number)
2. Agent greets: "Hi, I'm ShieldDesk support. How can I help you today?"
3. Customer: "I ordered a laptop three days ago and it still hasn't shipped. I want a refund."
4. Agent extracts intent → `order.lookup` (confidence 0.95, risk 0.05)
5. Decision function: trust=Authenticated(2), sentiment=frustrated(1.4x), risk=0.05 → **ALLOW**
6. ArmorIQ signs → MCP executes → Convex returns order data
7. Agent: "I found your order #1234 placed on Tuesday. It's in 'processing' status. Let me look into a refund for you."
8. Agent plans `order.refund` (confidence 0.88, risk 0.60)
9. Decision function: trust=Authenticated(2), ceiling=0.40, risk=0.60 → risk > ceiling → **ESCALATE**
10. Agent: "A refund of $1,299 needs manager approval at your account level. I've created a priority ticket and flagged it for immediate review. You'll get an SMS confirmation shortly."
11. Dashboard shows the full interaction: transcript, each tool call with its policy decision (green/red/yellow badges), confidence and risk numbers, ArmorIQ verification status

### Trust level behavior

| Trust Level | Label | Ceiling | Can do autonomously |
|---|---|---|---|
| 1 | Anonymous | 0.10 | FAQ search, order lookup (with order #) |
| 2 | Authenticated | 0.40 | + ticket creation, account lookup, order lookup |
| 3 | Premium | 0.65 | + account updates, ticket escalation |
| 4 | VIP | 0.85 | + refunds, most account changes |

## The decision surface

### Inputs
- **Confidence** (0-1): How sure is the LLM about what the customer asked for? Comes from MiniMax intent extraction.
- **Risk score** (0-1): How dangerous is this specific tool? Pre-assigned per tool.
- **Sentiment modifier**: How is the customer feeling? Frustrated customers get slightly expanded autonomy (higher threshold) because speed of resolution matters. Comes from Speechmatics sentiment analysis.
- **Trust level** (1-4): What access tier does this customer have?

### Sentiment multipliers
| Sentiment | Multiplier | Rationale |
|---|---|---|
| frustrated | 1.40 | Speed matters — resolve fast to prevent churn |
| neutral | 1.00 | Baseline |
| satisfied | 0.90 | No urgency — be cautious |
| calm | 0.80 | Low urgency — prefer human review |

### Decision logic
```
effectiveThreshold = trustCeiling[trustLevel] * sentimentMultiplier[sentiment]
```
- If risk >= 0.95 → **DENY** always (destructive actions like account deletion)
- If confidence < 0.70 → **ESCALATE** always (agent isn't sure what customer wants)
- If risk < effectiveThreshold AND confidence >= 0.85 → **ALLOW**
- Otherwise → **ESCALATE** (human must confirm)

### Tool risk scores
| Tool | Risk | Rationale |
|---|---|---|
| `faq.search` | 0.02 | Read-only, no customer data |
| `order.lookup` | 0.05 | Read-only, scoped to customer |
| `account.lookup` | 0.08 | Read-only, PII exposure |
| `ticket.create` | 0.10 | Creates record, low impact |
| `ticket.escalate` | 0.15 | Routes to human, low risk |
| `account.update` | 0.40 | Modifies customer data |
| `order.refund` | 0.60 | Financial transaction |
| `account.delete` | 1.00 | Destructive, never auto-allowed |

## Architecture

### Control plane (governs)
- **Policy Engine** (ArmorIQ): Cryptographic enforcement of allow/deny/escalate on every tool call
- **Decision Function**: `f(confidence, risk, sentiment, trust_level)` → allow/deny/escalate
- **State** (Convex): Real-time database, event history, auto-subscriptions for dashboard
- **Tool Registry**: MCP tool manifests defining what tools exist and their schemas
- **Identity & Trust** (Convex): Customer lookup → trust level
- **Audit Store** (Convex): Append-only event log of every decision

### Data plane (executes)
- **VAPI Channel**: Web widget → VAPI SDK → Custom LLM endpoint → MiniMax M2.5
- **Plivo Channel**: Phone call → Plivo WebSocket → Speechmatics ASR → ElevenLabs TTS
- **Agent Orchestrator**: MiniMax M2.5 for intent extraction, plan generation, response text
- **RAG Engine**: Convex vector search with MiniMax embo-01 embeddings
- **Tool Proxy**: ArmorIQ-verified execution of tool calls via MCP protocol
- **Knowledge Scraper**: rtrvr.ai populates the RAG knowledge base

### Data flow (VAPI web channel)
```
Customer speaks into browser microphone
  → VAPI SDK captures audio, runs built-in ASR
  → VAPI sends OpenAI-format messages to Custom LLM endpoint
  → API server queries Convex RAG for relevant knowledge
  → API server injects RAG context into system prompt
  → API server proxies to MiniMax M2.5 (with function definitions)
  → MiniMax returns response (possibly with tool_calls)
  → If tool_calls: VAPI sends to tool-calls webhook
    → Decision function evaluates each tool call
    → ALLOW: ArmorIQ capturePlan → getIntentToken → invoke → MCP server executes
    → ESCALATE: Log to Convex, inform customer
    → DENY: Log to Convex, inform customer
    → Results returned to VAPI → fed back to LLM for response generation
  → VAPI streams TTS audio to browser
  → Dashboard updates via Convex subscriptions (no polling)
```

### Data flow (Plivo phone channel)
```
Customer calls phone number
  → Plivo streams mulaw 8kHz audio over WebSocket
  → API server decodes base64, forwards binary to Speechmatics
  → Speechmatics returns partial/final transcripts + sentiment
  → On EndOfUtterance → complete turn sent to Agent Orchestrator
  → MiniMax M2.5 extracts intent + generates plan
  → [Same decision + ArmorIQ + MCP flow as VAPI channel]
  → Agent generates response text
  → ElevenLabs streams TTS audio (mulaw 8kHz)
  → API server sends playAudio to Plivo → customer hears response
  → Post-call: SMS summary sent via Plivo
```

## Data model (Convex)

### Tables

**customers** — Identity + trust configuration
- `email`: string
- `phoneE164`: optional string (E.164 format, indexed for caller lookup)
- `displayName`: string
- `trustLevel`: 1 | 2 | 3 | 4
- `tier`: "free" | "pro" | "enterprise"
- `metadata`: optional any (custom fields)

**orders** — Order records (demo seed data)
- `customerId`: reference to customers
- `orderNumber`: string (indexed)
- `status`: "processing" | "shipped" | "delivered" | "cancelled" | "refunded"
- `items`: array of `{ name: string, quantity: number, priceUsd: number }`
- `totalUsd`: number
- `placedAt`: number (epoch ms)
- `shippedAt`, `deliveredAt`: optional number

**tickets** — Support tickets
- `customerId`: reference to customers
- `conversationId`: optional reference to conversations
- `subject`: string
- `description`: string
- `priority`: "low" | "medium" | "high" | "urgent"
- `status`: "open" | "in_progress" | "waiting_customer" | "escalated" | "resolved" | "closed"
- `assignee`: optional string
- `createdAt`, `resolvedAt`: number (epoch ms)

**conversations** — Voice session records
- `channelType`: "vapi_web" | "plivo_phone"
- `channelSessionId`: string (VAPI call ID or Plivo CallUUID, idempotency key)
- `customerId`: optional reference to customers
- `status`: "active" | "completed" | "failed"
- `trustLevel`: number (resolved trust level for this session)
- `sentimentScore`: optional string (latest sentiment)
- `startedAt`, `endedAt`: number (epoch ms)
- `summary`: optional string (post-call summary)

**transcripts** — ASR/conversation output
- `conversationId`: reference to conversations
- `speaker`: "customer" | "agent"
- `isFinal`: boolean
- `text`: string
- `ts`: number

**agentActions** — Audit trail for every tool call attempt
- `conversationId`: optional reference to conversations
- `customerId`: optional reference to customers
- `toolName`: string
- `toolArgs`: any
- `status`: "planned" | "policy_checking" | "executing" | "executed" | "blocked" | "escalated" | "failed"
- `confidence`: optional number
- `riskScore`: optional number
- `effectiveThreshold`: optional number
- `sentimentAtTime`: optional string
- `policyDecision`: optional "allow" | "deny" | "escalate"
- `policyReason`: optional string
- `armoriqTokenId`, `armoriqPlanHash`: optional string
- `armoriqVerified`: optional boolean
- `result`: optional any
- `errorMessage`: optional string
- `durationMs`: optional number
- `ts`: number
- `idempotencyKey`: string

**conversationEvents** — Timeline entries for dashboard
- `conversationId`: reference to conversations
- `kind`: "message" | "tool_called" | "tool_blocked" | "tool_escalated" | "sentiment_changed" | "trust_resolved" | "summary_generated"
- `actorKind`: "customer" | "agent" | "system"
- `payload`: any (structured per kind)
- `ts`: number

**knowledgeDocuments** — RAG knowledge base
- `sourceUrl`: string (where it was scraped from)
- `title`: string
- `content`: string (plain text)
- `contentHash`: string (for dedup on re-scrape)
- `chunkIndex`: number (for multi-chunk documents)
- `embedding`: vector (1536 dimensions, MiniMax embo-01)
- `scrapedAt`: number (epoch ms)

## MCP Tool Server

ArmorIQ routes verified tool calls to this server. It speaks JSON-RPC 2.0 over HTTP with SSE responses.

### Protocol
- `POST /mcp` with `Content-Type: application/json`
- Request: `{ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "order.lookup", "arguments": {...} } }`
- Response: `Content-Type: text/event-stream` with `event: message\ndata: {json-rpc-response}\n\n`

### Required methods
- `initialize` — handshake
- `tools/list` — returns tool manifests with inputSchema
- `tools/call` — executes the named tool

### Tools

**faq.search** — Search knowledge base (risk: 0.02)
- Required: `query` (string)
- Returns: `{ results: [{ title, snippet, sourceUrl }] }`

**order.lookup** — Look up order details (risk: 0.05)
- Required: `orderNumber` (string)
- Optional: `customerId` (string)
- Returns: `{ order: { orderNumber, status, items, totalUsd, placedAt, ... } }`

**account.lookup** — Look up customer account (risk: 0.08)
- Required: `customerId` (string)
- Returns: `{ customer: { displayName, email, tier, ... } }` (PII-filtered based on trust)

**ticket.create** — Create a support ticket (risk: 0.10)
- Required: `subject` (string), `description` (string)
- Optional: `priority` ("low" | "medium" | "high" | "urgent"), `customerId` (string)
- Returns: `{ ticketId, status: "open" }`

**ticket.escalate** — Escalate ticket to human agent (risk: 0.15)
- Required: `ticketId` (string)
- Optional: `reason` (string), `urgency` ("high" | "low")
- Returns: `{ escalated: true, assignee }`

**account.update** — Update customer account fields (risk: 0.40)
- Required: `customerId` (string)
- Optional: `email` (string), `displayName` (string), `phoneE164` (string)
- Returns: `{ updated: true }`

**order.refund** — Process a refund (risk: 0.60)
- Required: `orderId` (string)
- Optional: `reason` (string), `amountUsd` (number — partial refund)
- Returns: `{ refundId, status: "processed", amountUsd }`

## VAPI Integration

### Custom LLM endpoint
`POST /vapi/chat/completions` — OpenAI-compatible format.

VAPI sends the conversation as OpenAI-format messages. The API server:
1. Extracts conversation context (customer ID, sentiment, trust level)
2. Queries Convex RAG for relevant knowledge based on latest customer message
3. Builds a system prompt with: agent persona, governance rules, RAG context, available tools
4. Proxies to MiniMax M2.5 with function definitions for the 7 support tools
5. Returns OpenAI-format response (may include `tool_calls`)

### Tool-calls webhook
`POST /vapi/tool-calls` — VAPI sends tool calls here for server-side execution.

The API server:
1. Logs the tool call to `agentActions` as "planned"
2. Runs the decision function: `f(confidence, risk, sentiment, trust_level)`
3. If ALLOW: ArmorIQ `capturePlan` → `getIntentToken` → `invoke` → MCP server executes
4. If ESCALATE: Updates `agentActions` to "escalated", returns message explaining why
5. If DENY: Updates `agentActions` to "blocked", returns message explaining why
6. Returns tool result to VAPI (VAPI feeds it back to the LLM for response generation)

### VAPI assistant configuration
Created via setup script or VAPI dashboard:
- Model: "custom" (points to our custom LLM endpoint)
- Custom LLM URL: `{PUBLIC_URL}/vapi/chat/completions`
- Server URL for tool calls: `{PUBLIC_URL}/vapi/tool-calls`
- First message: "Hi, I'm ShieldDesk support. How can I help you today?"
- Voice: ElevenLabs (configured in VAPI dashboard)

## Voice pipeline (Plivo phone channel)

### Audio format
mulaw 8kHz everywhere. No exceptions.
- Plivo inbound: `contentType="audio/x-mulaw;rate=8000"` on `<Stream>` element
- Speechmatics: `audio_format: { type: "raw", encoding: "mulaw", sample_rate: 8000 }`
- ElevenLabs: `output_format=ulaw_8000`
- Plivo outbound: `playAudio` with `contentType: "audio/x-mulaw"`, `sampleRate: 8000`

### Turn detection
1. Buffer `AddPartialTranscript` (display only, don't act)
2. On `AddTranscript` (final), append to turn buffer
3. On `EndOfUtterance`, close turn, send to Agent Orchestrator
4. Never act on partial transcripts

### Barge-in
If customer speaks during agent playback:
1. Send `clearAudio` to Plivo (stops playback)
2. Resume forwarding audio to Speechmatics
3. Process new turn normally

### Plivo Answer URL response
```xml
<Response>
  <Stream
    bidirectional="true"
    audioTrack="inbound"
    keepCallAlive="true"
    contentType="audio/x-mulaw;rate=8000"
    statusCallbackUrl="https://PUBLIC_URL/plivo/status"
    statusCallbackMethod="POST">
    wss://PUBLIC_URL/plivo/ws
  </Stream>
</Response>
```

## RAG Knowledge Base

### Indexing pipeline
1. `scripts/scrape-knowledge.ts` calls rtrvr.ai API to scrape configured URLs (help docs, FAQ pages, product pages)
2. rtrvr.ai returns cleaned markdown content
3. Content is chunked (512 tokens with 64-token overlap)
4. Each chunk is embedded using MiniMax `embo-01` via `POST /v1/embeddings`
5. Chunks stored in Convex `knowledgeDocuments` table with vector index
6. Content hash prevents duplicate indexing on re-scrape

### Query pipeline
1. Customer message is embedded using MiniMax `embo-01`
2. Convex vector search returns top-5 relevant chunks
3. Chunks are injected into the system prompt as context
4. MiniMax M2.5 generates response grounded in the retrieved knowledge

## Dashboard

### Pages
- `/` — Active conversation list (cards with customer, channel, status, trust level)
- `/conversations/[id]` — Conversation detail with four panels:
  1. Conversation card (customer info, channel, trust level, sentiment)
  2. Live transcript (scrolling, speaker labels: customer/agent)
  3. Agent action log (every tool call with policy decision badge: green=allow, red=deny, yellow=escalate, plus confidence/risk/threshold numbers, ArmorIQ verification status)
  4. Conversation events timeline (chronological events with actor + type badges)

### Real-time behavior
All queries use Convex React hooks. Updates push automatically when underlying data changes. No polling, no manual refresh.

### VAPI web widget
Embedded in the dashboard header or a dedicated `/talk` page. Uses `@vapi-ai/web` SDK. Customers (or judges) click "Talk to Support" and speak directly in the browser.

## Regression harness

### Golden dataset
`eval/golden/cases.jsonl` — one case per line:
```json
{
  "id": "case-id",
  "transcript": "what the customer said",
  "context": { "trustLevel": 2, "sentiment": "frustrated", "customerId": "cust_123" },
  "expected": {
    "action": "order_lookup",
    "fields": { "orderNumber": "ORD-1234" },
    "min_confidence": 0.85,
    "plan_steps": ["order.lookup"]
  },
  "expected_policy": {
    "order.lookup": "allow"
  }
}
```

### Metrics
- Action exact match rate (target: > 90%)
- Field extraction F1
- Confidence calibration error (target: < 0.15)
- False acceptance rate on high-risk tools (target: 0%)
- False escalation rate

## Non-functional requirements

### Latency
- VAPI end-to-end (speech → agent response audio): p95 < 2.5s
- MiniMax extraction: p50 300ms
- Convex RAG query: p50 100ms
- Policy check: p50 5ms
- Plivo end-of-speech → first agent audio: p95 < 2.0s

### Reliability
- Tool execution success rate: > 99.9%
- Policy evaluation availability: 100% (fail closed if ArmorIQ is unreachable)
- Every action with valid ArmorIQ verification: 100%

### Security
- No API keys in logs
- Plivo webhooks verified via HMAC-SHA256 signature validation
- Secrets loaded from environment, never committed
- PII awareness: customer phone numbers, emails, and transcript content are sensitive
- ArmorIQ cryptographic proof on every tool invocation — tamper-evident audit trail

### Fallbacks
- If MiniMax fails: ask customer to repeat; if persistent, fall back to ticket creation
- If Convex is down: buffer events in memory, replay when available
- If ArmorIQ is down: fail closed — deny all actions, inform customer, create ticket
- If TTS fails (Plivo channel): use Plivo `<Speak>` XML for minimal prompts
- If ASR fails (Plivo channel): fall back to DTMF ("Press 1 for order status...")

## What this is NOT

- Not a general-purpose voice agent framework
- Not a replacement for existing support platforms (it integrates alongside them)
- Not a monitoring or alerting tool
- Not multi-tenant in v1 (single deployment; multi-tenant is a future concern)
