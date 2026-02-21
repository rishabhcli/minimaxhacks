# ShieldDesk Flawless Inspection + Hardening Plan

Status date: 2026-02-21
Goal: certify ShieldDesk as production-grade for customer support quality, governance correctness, and reliability.

## 1) Exit Criteria (must all pass)

- Policy safety
  - False acceptance on high-risk tools (`risk >= 0.60`): `0`
  - `account.delete` auto-allow rate: `0`
- Agent quality
  - Golden/eval policy pass rate: `>= 95%`
  - Human review score (helpfulness + empathy + clarity): `>= 4.3/5`
  - Groundedness pass rate on knowledge questions: `>= 95%`
- Reliability
  - Tool execution success rate: `>= 99.5%`
  - Web voice call completion without fatal error: `>= 99%`
  - Phone turn-completion success (utterance -> response): `>= 99%`
- Performance
  - Web p95 turn latency: `< 2500ms`
  - Phone p95 turn latency: `< 2000ms` after EOU
- Auditability
  - 100% tool attempts recorded with decision + reason + threshold + risk
  - 100% allowed actions have verification metadata (or explicit fallback reason)

## 2) Owners

- `Owner A (Platform/API)`:
  - `apps/api-server`, policy executor, VAPI/Plivo routes, reliability
- `Owner B (Data/MCP)`:
  - `mcp-server`, `convex/*`, RAG indexing/retrieval, action/event integrity
- `Owner C (Quality/UX)`:
  - `apps/dashboard`, eval expansion, conversation quality rubric, E2E flows

## 3) Day-by-Day Execution

### Day 0 (Now): Foundation and hard gates

- Objective: make quality measurable and enforceable in CI.
- Tasks:
  - Add CI workflow with typecheck/test/eval/build gates.
  - Freeze current baseline metrics from `eval/run-eval.ts`.
  - Verify VAPI assistant config and call ended reasons trend.
- Commands:
  - `npm run typecheck --workspace=apps/api-server`
  - `npm run typecheck --workspace=mcp-server`
  - `npm run test --workspace=apps/api-server`
  - `npm run eval --workspace=eval`
  - `npm run build --workspace=apps/dashboard`

### Day 1: Data grounding and tool truthfulness

- Objective: eliminate non-grounded responses and stubbed FAQ behavior.
- Tasks:
  - Wire RAG search into `POST /vapi/chat/completions` prompt construction.
  - Make MCP `faq.search` return real Convex knowledge results.
  - Add fallback behavior when no docs are found.
- Verification:
  - `curl` chat completion with shipping/returns question -> retrieved context reflected in response.
  - `curl` MCP `tools/call` for `faq.search` -> actual KB matches.

### Day 2: Governance correctness and idempotency

- Objective: ensure decisions are deterministic, auditable, and replay-safe.
- Tasks:
  - Add idempotency key creation/check path for tool calls.
  - Ensure all tool attempts are logged (planned/checking/executed/escalated/blocked).
  - Enforce fail-closed behavior on governance execution errors.
- Verification:
  - Replay same webhook payload twice -> single execution, duplicated request returns prior result.
  - Confirm action records include decision metadata.

### Day 3: Phone-channel robustness

- Objective: improve phone conversation responsiveness and turn completion.
- Tasks:
  - Configure Speechmatics end-of-utterance silence trigger.
  - Validate barge-in behavior under active playback.
  - Add fallback for TTS failure path.
- Verification:
  - Plivo call with interruption during agent speech -> `clearAudio` observed and new turn processed.
  - ASR EOU events consistently produce response turns.

### Day 4: Security and abuse resistance

- Objective: lock down inbound webhook authenticity and prompt/tool safety.
- Tasks:
  - Add Plivo signature verification for `/plivo/answer` and `/plivo/status`.
  - Add request-level schema hardening and safe error envelopes.
  - Add adversarial eval cases (prompt injection, data exfil attempts, malicious tool args).
- Verification:
  - Invalid signature -> `403`.
  - Injection attempts do not bypass tool/policy controls.

### Day 5: Human-like support quality

- Objective: raise conversation quality to human support standard.
- Tasks:
  - Build rubric with dimensions: empathy, relevance, clarity, actionability, escalation phrasing.
  - Score sampled calls from VAPI call history.
  - Tighten system prompt and escalation messaging based on score deltas.
- Verification:
  - Rubric average `>= 4.3/5` on 30 sampled turns.

### Day 6: Full regression and sign-off

- Objective: freeze release candidate and certify against all exit criteria.
- Tasks:
  - Run complete regression suite and load sample.
  - Produce sign-off report with metric table and residual risk list.
- Verification:
  - All exit criteria pass.

## 4) MCP-first Inspection Workflow (mandatory)

- VAPI MCP
  - `mcp__vapi__list_assistants`
  - `mcp__vapi__get_assistant`
  - `mcp__vapi__list_calls`
  - `mcp__vapi__get_call`
- Convex MCP (after auth is fixed)
  - `mcp__convex__status`
  - `mcp__convex__tables`
  - `mcp__convex__data`
  - `mcp__convex__logs`
  - `mcp__convex__insights`
- Plivo / ElevenLabs MCP (channel reliability checks)
  - `mcp__plivo__get_cdr`
  - `mcp__elevenlabs__check_subscription`

## 5) CI Job Definitions

- `api-quality`
  - install
  - typecheck API
  - run API tests
- `mcp-quality`
  - typecheck MCP server
- `policy-eval`
  - run eval harness
- `dashboard-build`
  - build Next.js dashboard

All jobs block merge.

## 6) Tracking Format

For every task, record:

- `owner`
- `started_at`
- `completed_at`
- `evidence` (command output, MCP check, or screenshot)
- `result` (`pass` or `fail`)
- `notes`

