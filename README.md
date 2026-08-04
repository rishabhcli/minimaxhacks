# ShieldDesk AI

**Governance-first voice customer support agent.** Every action the AI takes — refunds, account changes, ticket escalations — passes the policy boundary before execution. When ArmorIQ is configured, approved actions also require cryptographic verification. Customers talk to a voice agent that can actually _do things_, not just answer questions.

Built for the [Return of the Agents](https://lu.ma/ReturnOfTheAgents) hackathon (Feb 21, 2026).

## How it works

1. Customer speaks to the AI agent (via web widget or phone call)
2. Agent understands intent using MiniMax M2.5 + RAG knowledge base
3. Agent plans actions (refund, lookup, escalation, etc.)
4. Every action is evaluated: `f(confidence, risk, sentiment, trust_level)` → allow / deny / escalate
5. When configured, approved actions are cryptographically signed by ArmorIQ before execution; verification failures escalate instead of bypassing the boundary
6. Results stream to a real-time dashboard — every decision is auditable

## Sponsors

| Sponsor | Tier | Role |
|---------|------|------|
| **MiniMax** | Platinum | LLM brain (M2.5) + RAG embeddings (embo-01) |
| **VAPI** | Gold | Web voice widget — primary demo channel |
| **Convex** | Gold | Real-time database, RAG vector search, Agent Threads |
| **Speechmatics** | Gold | Real-time STT and utterance boundaries for phone calls |
| **ElevenLabs** | Bronze | Text-to-speech |
| **ArmorIQ** | Bronze | Cryptographic execution verification when configured |

## Quick start

```bash
# 1. Clone and install
git clone <repo-url> && cd minimaxhacks
npm run bootstrap

# 2. Configure environment
cp .env.example .env
# Fill in the required service keys and URLs

# 3. Start Convex
npm run dev:convex

# 4. Start API server (port 3000)
npm run dev:api

# 5. Start MCP tool server (port 3001)
npm run dev:mcp

# 6. Start dashboard (port 3002)
npm run dev:dashboard
```

The dashboard also boots without a `.env` file in a clearly labeled local preview mode, so the operator surface can be inspected before Convex and voice credentials are configured. Add `NEXT_PUBLIC_CONVEX_URL` to switch the dashboard to live Convex subscriptions; add `NEXT_PUBLIC_API_URL` to point its top-bar health indicator at the API server; add `VAPI_PUBLIC_KEY` and `VAPI_ASSISTANT_ID` to enable the browser call button.

Before a local demo, set `DEMO_RESET_TOKEN` in `.env` and as a Convex deployment environment variable, then run `npm run reset-demo`. The command is disabled for `APP_ENV=production`, clears mutable demo/support state, preserves knowledge documents, and reseeds customers, orders, and real MiniMax embeddings.

Phone calls generate a bounded MiniMax post-call summary after the stream closes. When `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN`, and `PLIVO_PHONE_NUMBER` are configured, ShieldDesk sends that summary once to the caller through Plivo SMS and records the delivery status in the audit timeline. Missing SMS configuration leaves the call completed without attempting delivery.

`MCP_AUTH_TOKEN` must be set in both the API server and MCP server environments. `ALLOW_CLIENT_GOVERNANCE_OVERRIDES` defaults to `false` and should stay disabled outside tightly controlled local demos.

Browser voice sessions without a server-resolved customer identity are intentionally treated as Trust 1 anonymous sessions. Account-scoped tools require verified customer context; the voice lab's red-team metadata is only a requested local-demo context and is ignored unless client overrides are explicitly enabled.

Set `APP_ENV=production` for the deployed API process. API startup rejects missing Vapi webhook auth, non-HTTPS public URLs, local CORS origins, and client governance overrides. Webhook and MCP requests are body-size limited, rate limited, and return an `X-Request-Id` for tracing; tune `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`, and `PROVIDER_TIMEOUT_MS` for the deployment. `/health` reports configured versus degraded optional providers without pretending to perform a live provider probe.

For Vapi webhook auth, configure `VAPI_WEBHOOK_SECRET` and have Vapi send it either as `Authorization: Bearer <secret>` or the legacy `X-Vapi-Secret` header. Plivo callbacks and the `/plivo/ws` upgrade path now validate Plivo V3 webhook signatures using `PLIVO_AUTH_TOKEN`.

## Verification

Use these root commands before shipping changes:

```bash
npm run build
npm run test
npm run typecheck
npm run eval
```

The repo expects Node 20.x or newer. Use the pinned `.nvmrc` when switching runtimes.

## Architecture

```
                    ┌─────────────┐
                    │   Customer  │
                    └──────┬──────┘
                           │
              ┌────────────┴────────────┐
              │                         │
     ┌────────▼────────┐     ┌─────────▼─────────┐
     │   VAPI Widget   │     │   Speechmatics    │
     │   (web demo)    │     │   + ElevenLabs     │
     └────────┬────────┘     └─────────┬──────────┘
              └────────────┬───────────┘
                           │
                  ┌────────▼────────┐
                  │   API Server    │
                  │   (MiniMax M2.5 │
                  │    + RAG)       │
                  └────────┬────────┘
                           │
                  ┌────────▼────────┐
                  │  Decision Fn    │
                  │  f(conf, risk,  │
                  │   sent, trust)  │
                  └────────┬────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
     ┌────────▼────────┐     ┌─────────▼─────────┐
     │    ArmorIQ       │     │     Convex         │
     │  (sign + verify) │     │  (state + RAG +    │
     └────────┬────────┘     │   audit trail)     │
              │              └────────────────────┘
     ┌────────▼────────┐
     │  MCP Tool Server │
     │  (execute tools) │
     └─────────────────┘
```

## Project structure

```
apps/api-server/       — Express server: VAPI webhooks, agent orchestrator
apps/dashboard/        — Next.js 16 frontend with Convex real-time subscriptions
convex/                — Convex schema + queries + mutations
mcp-server/            — Customer support tool server (JSON-RPC 2.0 + SSE)
packages/shared/       — Shared TypeScript types
scripts/               — Setup scripts (VAPI assistant, seed data)
eval/                  — Regression harness for intent extraction + policy decisions
```

## License

Hackathon project — not licensed for production use.
