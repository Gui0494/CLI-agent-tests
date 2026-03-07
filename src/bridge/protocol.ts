import { z } from "zod";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
  id: number;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
  id: number;
}

const JsonRpcResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  result: z.unknown().optional(),
  error: z.object({
    code: z.number(),
    message: z.string(),
    data: z.unknown().optional(),
  }).optional(),
  id: z.number(),
}).refine((value) => value.result !== undefined || value.error !== undefined, {
  message: "JSON-RPC response must include result or error",
});

export function createRequest(method: string, params: Record<string, unknown>, id: number): string {
  const req: JsonRpcRequest = { jsonrpc: "2.0", method, params, id };
  return JSON.stringify(req) + "\n";
}

export function parseResponse(data: string): JsonRpcResponse {
  return JsonRpcResponseSchema.parse(JSON.parse(data));
}
