# Repository Guidelines

## Project Structure & Module Organization
This repo is a TypeScript monorepo using npm workspaces.

- `apps/api-server/`: Express API for VAPI/Plivo webhooks, policy execution, and orchestration.
- `apps/dashboard/`: Next.js 14 dashboard and web voice UI (`src/app`, `src/components`).
- `mcp-server/`: MCP-compatible tool server (JSON-RPC).
- `convex/`: Convex schema, queries, and mutations for conversations, actions, transcripts, and KB search.
- `packages/shared/`: Shared policy, risk, and type utilities.
- `eval/`: Regression harness (`run-eval.ts`, `golden/cases.jsonl`).
- `scripts/`: operational scripts (seed data, scrape knowledge, setup assistant).

## Build, Test, and Development Commands
- `npm install`: install all workspace deps.
- `npm run dev:convex`: start Convex dev backend.
- `npm run dev:api`: start API server on `:3000`.
- `npm run dev:mcp`: start MCP server on `:3001`.
- `npm run dev:dashboard`: start Next dashboard on `:3002`.
- `npm run test --workspace=apps/api-server`: run API tests (Node test runner + `tsx`).
- `npm run typecheck --workspace=apps/api-server`: strict TS checks for API.
- `npm run build --workspace=apps/dashboard`: production build verification for UI.
- `npm run eval`: run regression cases for policy/agent behavior.

## Coding Style & Naming Conventions
- Language: strict TypeScript (`strict: true`); prefer explicit types at module boundaries.
- Indentation: 2 spaces; keep semicolon usage consistent with existing code.
- Naming: `camelCase` for vars/functions, `PascalCase` for React components, `kebab-case` for server route/service files (e.g., `chat-completions.ts`).
- Prefer small, focused modules; colocate tests under `apps/api-server/tests`.

## Testing Guidelines
- Add/adjust tests for behavior changes in policy, webhook validation, and tool execution paths.
- Use file pattern `*.test.ts` under `apps/api-server/tests`.
- Update `eval/golden/cases.jsonl` when intent/policy expectations change.
- Before opening a PR, run: API tests, API typecheck, dashboard build, and eval.

## Commit & Pull Request Guidelines
- Follow concise, imperative commit subjects (seen in history):  
  `Fix Plivo phone channel: ...`, `Harden agent governance and redesign dashboard UX`.
- PRs should include:
  - what changed and why,
  - impacted modules,
  - verification commands run and outcomes,
  - screenshots/video for dashboard or voice UX changes.

## Security & Configuration Tips
- Keep secrets only in `.env`/deployment config; never commit credentials.
- Validate webhook signatures (Plivo) and maintain fail-closed policy behavior for sensitive tools.
- If changing trust/policy thresholds, include rationale and eval updates.
