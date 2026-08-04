import { z } from "zod";
import { TOOL_MANIFESTS } from "./tools/registry.js";
import { executeToolCall, type ToolExecutionContext } from "./tools/handlers.js";
import type { Logger } from "pino";

const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.unknown()).optional(),
});

const ToolCallParamsSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.unknown()).default({}),
  context: z.object({
    customerId: z.string().min(1).optional(),
    conversationId: z.string().min(1).optional(),
  }).optional(),
});

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: string | number;
  result: unknown;
}

interface JsonRpcError {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

function success(id: string | number, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

function error(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): JsonRpcError {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

export async function handleJsonRpc(
  body: unknown,
  log: Logger,
  execute: typeof executeToolCall = executeToolCall,
): Promise<JsonRpcResponse | null> {
  const parsed = JsonRpcRequestSchema.safeParse(body);
  if (!parsed.success) {
    return error(null, -32700, "Parse error", parsed.error.issues);
  }

  const { id, method, params } = parsed.data;
  log.info({ method, id }, "JSON-RPC request");

  // MCP lifecycle notifications, including notifications/initialized, are
  // valid JSON-RPC messages without an id and must not receive a JSON-RPC
  // response body.
  if (id === undefined) return null;

  switch (method) {
    case "initialize":
      return success(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "shielddesk-mcp", version: "0.1.0" },
      });

    case "tools/list":
      return success(id, { tools: TOOL_MANIFESTS });

    case "tools/call": {
      const toolParams = ToolCallParamsSchema.safeParse(params);
      if (!toolParams.success) {
        return error(id, -32602, "Invalid tools/call params", toolParams.error.issues);
      }

      try {
        const result = await execute(
          toolParams.data.name,
          toolParams.data.arguments,
          (toolParams.data.context ?? {}) as ToolExecutionContext,
        );
        return success(id, result);
      } catch (err) {
        const message =
          err instanceof z.ZodError
            ? `Validation error: ${err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`
            : err instanceof Error
              ? err.message
              : "Unknown error";
        log.error({ err, toolName: toolParams.data.name }, "Tool execution failed");
        return error(id, -32000, message);
      }
    }

    default:
      return error(id, -32601, `Method not found: ${method}`);
  }
}
