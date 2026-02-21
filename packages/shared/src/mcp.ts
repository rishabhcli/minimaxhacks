import { z } from "zod";

// ── JSON-RPC 2.0 types for MCP protocol ──

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.record(z.unknown()).optional(),
});
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

export const JsonRpcSuccessResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  result: z.unknown(),
});
export type JsonRpcSuccessResponse = z.infer<
  typeof JsonRpcSuccessResponseSchema
>;

export const JsonRpcErrorResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
  error: z.object({
    code: z.number(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
});
export type JsonRpcErrorResponse = z.infer<typeof JsonRpcErrorResponseSchema>;

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

// ── MCP tool-specific types ──

export const McpToolCallParamsSchema = z.object({
  name: z.string(),
  arguments: z.record(z.unknown()),
});
export type McpToolCallParams = z.infer<typeof McpToolCallParamsSchema>;

export const McpToolManifestSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.object({
    type: z.literal("object"),
    properties: z.record(z.unknown()),
    required: z.array(z.string()).optional(),
  }),
});
export type McpToolManifest = z.infer<typeof McpToolManifestSchema>;
