# ShieldDesk AI Top-100 Improvements Backlog

Status date: 2026-03-25
Scope: repo-first backlog grounded in the current implementation, product docs, and verification baseline.

## Executive Summary

Current baseline:
- `npm run test --workspace=apps/api-server` passes
- `npm run eval` passes
- `npm run build --workspace=apps/api-server` passes
- `npm run build --workspace=mcp-server` passes
- `npm run build --workspace=apps/dashboard` passes

Strongest themes:
- Tighten trust, identity, and governance boundaries so the demo is credible under scrutiny.
- Replace implicit or loosely typed contracts with generated and shared types.
- Harden provider integrations for degraded mode, replay safety, and observability.
- Turn the dashboard from a passive viewer into an operator console.
- Make knowledge retrieval, evals, and scripts reflect the actual data model instead of happy paths.

Related doc:
- This backlog complements `docs/flawless-inspection-execution-plan.md` by expanding beyond hardening into product, tooling, and roadmap leverage.

## Tier 1: Do Next

1. Replace `anyApi` usage in the API server, dashboard, and MCP server with generated Convex clients so broken queries stop compiling instead of failing at runtime.
2. Promote shared request and response schemas for tool results into `packages/shared` so VAPI, MCP, Convex, and the dashboard stop drifting independently.
3. Remove the direct-MCP fallback in `apps/api-server/src/policy/executor.ts` when ArmorIQ is enabled and fail closed with an explicit degraded-state response.
4. Add webhook authentication for VAPI endpoints so `POST /vapi/chat/completions` and `POST /vapi/tool-calls` are not implicitly trusted.
5. Replace `Access-Control-Allow-Origin: *` in `apps/api-server/src/index.ts` with an allowlist driven by environment configuration.
6. Add dashboard authentication and operator roles so the audit UI is not publicly readable.
7. Resolve customer identity and trust level from verified session data instead of the hardcoded values sent by `apps/dashboard/src/components/VapiWidget.tsx`.
8. Stop accepting client-supplied confidence values and source confidence only from model output or server-side orchestration.
9. Add correlation IDs across API, MCP, Convex, and telephony logs so one conversation can be traced end to end.
10. Persist explicit `planned` and `policy_checking` action states before execution so the audit trail reflects the full lifecycle instead of only the terminal state.
11. Persist web-channel transcript turns and message events with the same fidelity as phone sessions so the dashboard has a complete audit view for VAPI calls.
12. Add end-to-end tests for the VAPI tool-call path covering allow, escalate, deny, and idempotent replay.
13. Use vector retrieval in `apps/api-server/src/vapi/chat-completions.ts` instead of only the text fallback so the RAG path matches the intended architecture.
14. Add a strict “no retrieved evidence” response mode for policy and support questions so the agent asks for clarification instead of improvising policy details.
15. Cache or batch MiniMax embedding requests for `faq.search` so repeated knowledge queries do not pay full provider latency every time.
16. Fix the script-to-schema contract drift between `scripts/seed-data.ts`, `scripts/scrape-knowledge.ts`, `convex/customers.ts`, `convex/orders.ts`, and `convex/knowledgeDocuments.ts`.
17. Remove the `customer?._id ?? ("" as any)` fallback in `convex/orders.ts` and fail seed or create flows when customer resolution breaks.
18. Implement a real `knowledgeDocuments.upsert` mutation or remove the fallback call from `scripts/scrape-knowledge.ts`.
19. Stop inserting knowledge documents with empty `embedding` arrays and add an explicit ingestion state if embeddings are not yet available.
20. Add redacted tool arguments and structured tool results to the dashboard so operators can inspect what was attempted without exposing raw secrets or unnecessary PII.
21. Add dashboard filters for status, channel, trust level, sentiment, and policy decision so triage does not require manual scrolling.
22. Standardize API and MCP error envelopes so clients can distinguish validation failures, provider failures, policy denials, and internal faults.
23. Add request rate limiting and abuse protection to the public API routes, especially VAPI and Plivo ingress.
24. Add per-provider timeout and retry policies with jitter for MiniMax, ArmorIQ, Speechmatics, ElevenLabs, and rtrvr calls.
25. Add degraded-mode behavior for each external dependency so one provider outage does not collapse the entire conversation flow.
26. Emit structured latency and outcome metrics for chat turns, tool execution, ASR, TTS, and webhook handling.
27. Resolve phone-caller identity via `customers.getByPhone` on Plivo call start instead of defaulting every caller to trust level 2.
28. Persist phone conversation state, transcripts, and events from `apps/api-server/src/plivo/gateway.ts` with the same completeness expected by the dashboard.
29. Redact secrets, auth headers, phone numbers, and email addresses from logs before they reach stdout or external log sinks.
30. Tighten env validation so critical production secrets cannot silently default to empty strings.

## Tier 2: High Leverage

31. Generate a typed MCP manifest from a single source of truth so `tools/list`, tool handlers, and VAPI function definitions cannot drift.
32. Add contract tests asserting that every registered MCP tool has a matching handler, risk score, shared schema, and dashboard rendering path.
33. Normalize tool naming once across `faq_search` and `faq.search` style aliases so translation logic is not scattered through orchestrator code.
34. Enforce customer scoping in tool handlers so `order.lookup` and `account.lookup` cannot read unrelated records when a customer context exists.
35. Add trust-aware field filtering to `account.lookup` so PII exposure follows policy instead of always returning the same shape.
36. Require customer ownership checks before `order.lookup` returns data for a given order number.
37. Validate refund preconditions in `convex/orders.ts` so already-refunded, cancelled, or ineligible orders cannot be processed as happy-path refunds.
38. Expand `ticket.escalate` into a real assignment workflow with owner, queue, and timestamp changes instead of a thin status patch.
39. Add an operator workflow in the dashboard for viewing and resolving escalated actions instead of only observing them.
40. Generate and store post-call summaries asynchronously so long-running summarization does not block realtime conversation handling.
41. Show partial versus final transcript markers in the dashboard so operators can distinguish live speech from committed turns.
42. Add conversation latency, tool success, and escalation-rate views to the dashboard so it works as an operations console, not just a feed.
43. Add a customer context pane in the conversation detail page with tier, prior tickets, prior refunds, and order history.
44. Add provider health and degraded-state banners to the dashboard when external dependencies are failing.
45. Add operator retry controls for failed but policy-allowed actions with full idempotency protection.
46. Run an accessibility pass on the dashboard and widget flows, including focus order, labels, color contrast, and keyboard support.
47. Improve narrow-screen behavior for the dashboard so conversation review is usable on laptops and tablets, not only wide screens.
48. Capture barge-in success metrics and tune thresholds in `apps/api-server/src/plivo/gateway.ts` using observed call traces instead of static heuristics.
49. Support alternate ASR or TTS providers behind adapters so the phone channel can fail over when Speechmatics or ElevenLabs degrades.
50. Verify and persist Plivo post-call SMS confirmations as first-class conversation events instead of treating them as an implied future step.
51. Add signature verification and persistence for all Plivo status or callback routes, not only the answer flow.
52. Add replay protection for inbound webhooks using provider event IDs, timestamps, and short-lived nonce storage.
53. Separate idempotency storage from `agentActions` so transport-level replay protection and business-level duplicate suppression can evolve independently.
54. Expand `eval/golden/cases.jsonl` with adversarial cases such as prompt injection, data exfiltration attempts, and risky partial refunds.
55. Add groundedness evals for knowledge answers so passing policy logic is not mistaken for trustworthy support behavior.
56. Build a telephony-focused regression harness that replays recorded ASR payloads and expected turn outcomes.
57. Add auth between the API server and MCP server so direct tool invocation is not trusted solely because it is on an internal URL.
58. Add SSE protocol compliance tests for the MCP server, including streaming headers, framing, and error propagation.
59. Add pagination and cursor-based loading for conversation, transcript, and action views so large histories do not rely on fixed `take(50)` style limits.
60. Define retention and archival policies for transcripts, events, and action logs so the product can scale without unbounded hot storage.
61. Make audit records append-only or tamper-evident so governance evidence cannot be rewritten after execution.
62. Surface ArmorIQ verification metadata and plan hashes directly in the dashboard instead of hiding them in stored records.
63. Add a policy simulator UI where operators can test hypothetical confidence, risk, sentiment, and trust inputs.
64. Add a threshold tuning workspace for experimenting with new trust ceilings or sentiment multipliers before changing production policy.
65. Add tests for sentiment normalization so provider-specific labels do not silently bypass the four supported governance categories.
66. Version the system prompt and tool instructions so quality regressions can be tied to prompt changes.
67. Wrap MiniMax, ArmorIQ, Speechmatics, and ElevenLabs behind provider adapters so business logic is not coupled to raw fetch shapes.
68. Add a one-command local bootstrap that starts Convex, API, MCP, and dashboard together with startup checks.
69. Add root workspace scripts for full-repo typecheck, build, and test so CI and local verification share the same entrypoints.
70. Expand GitHub Actions to publish artifacts, summaries, and failure diagnostics rather than only pass or fail a small set of jobs.

## Tier 3: Strategic Follow-On

71. Add role-based access control for human agents, managers, and admins across the dashboard and approval workflows.
72. Build a human approval queue where escalated actions can be reviewed, approved, rejected, and replayed from the dashboard.
73. Add two-step confirmation for high-risk customer actions such as refunds and account updates before execution is attempted.
74. Build a real customer authentication flow for the web widget instead of embedding static trust metadata in the assistant start payload.
75. Add OTP or account-verification flows for the phone channel so caller trust can be upgraded during a call.
76. Add abuse, fraud, and spam signals to the governance layer so repeated high-risk callers are handled differently from normal support flows.
77. Turn `scripts/scrape-knowledge.ts` into a scheduled ingestion job with source configs, run history, and failure reporting.
78. Version chunking and embedding strategies so the knowledge base can be re-indexed without guesswork.
79. Add document freshness and staleness scoring so old policies can be deprioritized or flagged in answers.
80. Attribute answer sources in the agent response and dashboard so operators can see what knowledge grounded a reply.
81. Route model choice by task so extraction, response generation, summarization, and embedding are not forced through a single model shape.
82. Track per-conversation provider cost for MiniMax, Speechmatics, ElevenLabs, ArmorIQ, and Convex operations.
83. Add budget guardrails and cost-based degraded modes so demo usage spikes do not create silent spend blowups.
84. Generate synthetic conversation sets for shipping, refund, fraud, outage, and abuse scenarios to expand eval coverage quickly.
85. Build operational dashboards for SLOs, error budgets, latency percentiles, and provider failure rates.
86. Add runbooks for provider outage, webhook drift, Convex schema mismatch, and telephony failure modes.
87. Add a dead-letter queue for failed inbound webhook events so they can be replayed after transient issues.
88. Move long-running workflows such as summarization, scraping, and re-indexing onto explicit background jobs instead of request paths and scripts.
89. Separate demo, staging, and production configuration profiles so policy and provider changes can be promoted safely.
90. Add anonymized export and replay tooling so support conversations can be used for evals without exposing customer identity.
91. Write compliance-oriented data handling docs covering PII, retention, redaction, and operator access.
92. Run chaos tests for provider outages, slow downstreams, malformed webhooks, and Convex timeouts.
93. Add server-side allowlists or capability gates for MCP tools so only explicitly approved tool calls are reachable from orchestration.
94. Add prompt-injection and tool-argument safety filters before governance so malicious content is normalized before scoring.
95. Build a fixtures library of recorded provider payloads for VAPI, Plivo, Speechmatics, and MiniMax to stabilize regression testing.
96. Add visual regression tests for the dashboard so UI polish and operational readability do not regress unnoticed.
97. Break shared dashboard patterns into reusable components and document a small design system for future operator workflows.
98. Add a demo mode with scripted customer journeys and preloaded data so judges and teammates can reproduce the strongest flows reliably.
99. Create a release checklist that ties code, provider config, eval status, and dashboard screenshots into one pre-demo gate.
100. Re-score and refresh this backlog quarterly using observed metrics, production incidents, and completed work so prioritization stays evidence-based.
