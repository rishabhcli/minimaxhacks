---
active: true
iteration: 1
max_iterations: 20
completion_promise: "MCP COMPLETE"
started_at: "2026-02-21T18:55:49Z"
---

Build the MCP server in mcp-server/. Implement JSON-RPC 2.0 + SSE transport, tool registry with manifests for order.lookup, order.refund, ticket.create, account.update, account.delete. Each tool reads/writes Convex via ConvexHttpClient. Validate all inputs with Zod. Output <promise>MCP COMPLETE</promise> when the server starts on port 3001.
