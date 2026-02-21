# ShieldDesk AI

**Governance-first voice customer support agent.** Every action the AI takes — refunds, account changes, ticket escalations — is cryptographically verified before execution. Customers talk to a voice agent that can actually _do things_, not just answer questions.

Built for the [Return of the Agents](https://lu.ma/ReturnOfTheAgents) hackathon (Feb 21, 2026).

## How it works

1. Customer speaks to the AI agent (via web widget or phone call)
2. Agent understands intent using MiniMax M2.5 + RAG knowledge base
3. Agent plans actions (refund, lookup, escalation, etc.)
4. Every action is evaluated: `f(confidence, risk, sentiment, trust_level)` → allow / deny / escalate
5. Approved actions are cryptographically signed by ArmorIQ before execution
6. Results stream to a real-time dashboard — every decision is auditable

## Sponsors

| Sponsor | Tier | Role |
|---------|------|------|
| **MiniMax** | Platinum | LLM brain (M2.5) + RAG embeddings (embo-01) |
| **VAPI** | Gold | Web voice widget — primary demo channel |
| **Convex** | Gold | Real-time database, RAG vector search, Agent Threads |
| **Speechmatics** | Gold | Real-time STT for phone channel + sentiment analysis |
| **Plivo** | Silver | Telephony (phone channel) + SMS confirmations |
| **ElevenLabs** | Bronze | Text-to-speech for phone channel |
| **rtrvr.ai** | Bronze | Web scraping to build RAG knowledge base |
| **ArmorIQ** | Bronze | Cryptographic policy enforcement on every tool call |

## Quick start

```bash
# 1. Clone and install
git clone <repo-url> && cd minimaxhacks
npm install

# 2. Configure environment
cp .env.example .env
# Fill in all API keys (see .env.example for details)

# 3. Start Convex
cd convex && npx convex dev

# 4. Start API server (port 3000)
cd apps/api-server && npm run dev

# 5. Start MCP tool server (port 3001)
cd mcp-server && npm run dev

# 6. Start dashboard (port 3002)
cd apps/dashboard && npm run dev
```

For the Plivo phone channel, you also need a tunnel (ngrok) to expose the API server.

## Architecture

```
                    ┌─────────────┐
                    │   Customer  │
                    └──────┬──────┘
                           │
              ┌────────────┴────────────┐
              │                         │
     ┌────────▼────────┐     ┌─────────▼─────────┐
     │   VAPI Widget   │     │   Plivo Phone      │
     │   (web demo)    │     │   + Speechmatics   │
     └────────┬────────┘     │   + ElevenLabs     │
              │              └─────────┬──────────┘
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
apps/api-server/       — Express server: VAPI webhooks, Plivo webhooks, agent orchestrator
apps/dashboard/        — Next.js 14 frontend with Convex real-time subscriptions
convex/                — Convex schema + queries + mutations
mcp-server/            — Customer support tool server (JSON-RPC 2.0 + SSE)
packages/shared/       — Shared TypeScript types
scripts/               — Setup scripts (VAPI assistant, seed data, scraper)
eval/                  — Regression harness for intent extraction + policy decisions
```

## License

Hackathon project — not licensed for production use.
