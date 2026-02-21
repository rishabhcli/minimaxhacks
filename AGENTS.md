# Repository Guidelines

## Project Structure & Module Organization
This repository is an npm workspace monorepo.
- `apps/api-server/`: Express + WebSocket backend (VAPI/Plivo webhooks, policy execution).
- `apps/dashboard/`: Next.js 14 App Router frontend.
- `mcp-server/`: JSON-RPC/SSE tool server.
- `convex/`: schema and Convex query/mutation functions.
- `packages/shared/`: shared TypeScript/Zod types.
- `eval/`: regression harness (`run-eval.ts`, `golden/cases.jsonl`).
- `scripts/`: setup/seed/scraping utilities.

## Build, Test, and Development Commands
- `npm install`: install all workspace dependencies.
- `npm run dev:convex`: start Convex dev sync from root.
- `npm run dev:api`: run API server on port `3000`.
- `npm run dev:mcp`: run MCP server on port `3001`.
- `npm run dev:dashboard`: run Next.js dashboard on port `3002`.
- `npm run test --workspace=apps/api-server`: run API unit tests.
- `npm run eval`: run policy regression checks in `eval/`.
- `npm run build --workspace=apps/api-server` (or `mcp-server` / `apps/dashboard`): production builds per app.

## Coding Style & Naming Conventions
- Language: TypeScript (strict mode, ESM).
- Formatting in current codebase: 2-space indentation, semicolons, double quotes.
- File names: kebab-case for modules (`tool-definitions.ts`), PascalCase for React components (`VapiWidget.tsx`).
- Validate external inputs with Zod at service boundaries.
- Keep shared domain contracts in `packages/shared/src/` and import from workspaces.

## Testing Guidelines
- API tests use Node’s test runner with `tsx`; place tests in `apps/api-server/tests/*.test.ts`.
- Prefer focused unit tests for policy and tool execution paths.
- After policy/tool behavior changes, run both:
  1. `npm run test --workspace=apps/api-server`
  2. `npm run eval`
- Add/adjust golden cases in `eval/golden/cases.jsonl` when decision behavior changes.

## Commit & Pull Request Guidelines
- Follow existing history style: short, imperative, capitalized subject lines (example: `Fix Plivo phone channel greeting flow`).
- Keep commits scoped to one logical change.
- PRs should include: purpose, affected modules, test commands run, and env/config updates.
- For UI changes, attach dashboard screenshots; for webhook/tooling changes, include sample request/response snippets.

## Security & Configuration Tips
- Keep secrets only in root `.env`; never commit credentials.
- All services load configuration from root `.env` via `dotenv`.
- Do not commit generated/build artifacts (for example `convex/_generated/`, `.next/`, `dist/`).
