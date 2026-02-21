import { z } from "zod";
import { TOOL_MANIFESTS } from "./tools/registry.js";
import { executeToolCall } from "./tools/handlers.js";
import type { Logger } from "pino";

const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.record(z.unknown()).optional(),
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
  log: Logger
): Promise<JsonRpcResponse> {
  const parsed = JsonRpcRequestSchema.safeParse(body);
  if (!parsed.success) {
    return error(null, -32700, "Parse error", parsed.error.issues);
  }

  const { id, method, params } = parsed.data;
  log.info({ method, id }, "JSON-RPC request");

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
      const name = params?.name;
      const args = params?.arguments;

      if (typeof name !== "string") {
        return error(id, -32602, "Missing required param: name");
      }

      try {
        const result = await executeToolCall(
          name,
          (args as Record<string, unknown>) ?? {}
        );
        return success(id, result);
      } catch (err) {
        const message =
          err instanceof z.ZodError
            ? `Validation error: ${err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`
            : err instanceof Error
              ? err.message
              : "Unknown error";
        log.error({ err, toolName: name }, "Tool execution failed");
        return error(id, -32000, message);
      }
    }

    default:
      return error(id, -32601, `Method not found: ${method}`);
  }
}
