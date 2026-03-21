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

// ─── Incoming Request Schema (from Python → Node) ────────

const JsonRpcIncomingRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string().min(1).max(256),
  params: z.record(z.unknown()).default({}),
  id: z.number().int(),
});

// ─── RPC Method Parameter Schemas ────────────────────────
// Validates params for each known RPC method before dispatching.

export const RpcMethodSchemas = {
  // Python → Node: request to run a Node-side tool
  run_node_tool: z.object({
    tool_name: z.string().min(1).max(128).regex(/^[a-z_][a-z0-9_]*$/i, "Invalid tool name format"),
    tool_args: z.record(z.unknown()),
  }),

  // Python → Node: permission request
  permission_request: z.object({
    action: z.string().min(1).max(256),
    args: z.record(z.unknown()).optional(),
    risk_level: z.string().max(32).optional(),
    reason: z.string().max(2048).optional(),
  }),

  // Node → Python: search
  search: z.object({
    query: z.string().min(1).max(10_000),
    max_results: z.number().int().min(1).max(100).optional(),
  }),

  // Node → Python: fetch_url
  fetch_url: z.object({
    url: z.string().url().max(8192),
  }),

  // Node → Python: LLM chat
  llm_chat: z.object({
    messages: z.array(z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string(),
    })).min(1),
    model: z.string().max(256).optional(),
  }),

  // Node → Python: LLM stream
  llm_stream: z.object({
    prompt: z.string().min(1).max(100_000),
    system_prompt: z.string().max(100_000).optional(),
    model: z.string().max(256).optional(),
    temperature: z.number().min(0).max(2).optional(),
    provider: z.string().max(64).optional(),
    api_key: z.string().max(1024).optional(),
  }),

  // Node → Python: agent run
  agent_run: z.object({
    user_input: z.string().min(1).max(100_000),
    max_steps: z.number().int().min(1).max(50).optional(),
  }),

  // Node → Python: execute tool directly
  execute_tool: z.object({
    name: z.string().min(1).max(128).regex(/^[a-z_][a-z0-9_]*$/i, "Invalid tool name format"),
    params: z.record(z.unknown()).optional(),
  }),

  // Node → Python: manage history
  manage_history: z.object({
    action: z.enum(["load", "clear", "undo", "status"]).optional(),
  }),

  // Node → Python: plan
  llm_plan: z.object({
    task: z.string().min(1).max(100_000),
  }),

  // Node → Python: academic search
  academic_search: z.object({
    query: z.string().min(1).max(10_000),
  }),

  // Bidirectional: verification pipeline
  run_verification: z.object({
    stages: z.array(z.string().max(32)).optional(),
  }),

  // Node → Python: backup management
  create_backup: z.object({
    files: z.array(z.string().max(4096)).min(1),
    label: z.string().max(64).optional(),
  }),

  restore_backup: z.object({
    backup_path: z.string().min(1).max(4096),
  }),
} as const;

export type RpcMethodName = keyof typeof RpcMethodSchemas;

/**
 * Validate params for a known RPC method.
 * Returns validated params or throws ZodError.
 */
export function validateMethodParams(method: string, params: Record<string, unknown>): Record<string, unknown> {
  const schema = RpcMethodSchemas[method as RpcMethodName];
  if (!schema) {
    // Unknown method — reject with error (default-deny)
    throw new Error(`Unknown RPC method: "${method}". Payload rejected.`);
  }
  return schema.parse(params) as Record<string, unknown>;
}

/**
 * Parse and validate an incoming JSON-RPC request (from Python).
 */
export function parseIncomingRequest(data: string): JsonRpcRequest {
  const parsed = JSON.parse(data);
  return JsonRpcIncomingRequestSchema.parse(parsed) as JsonRpcRequest;
}

export function createRequest(method: string, params: Record<string, unknown>, id: number): string {
  const req: JsonRpcRequest = { jsonrpc: "2.0", method, params, id };
  return JSON.stringify(req) + "\n";
}

export function parseResponse(data: string): JsonRpcResponse {
  return JsonRpcResponseSchema.parse(JSON.parse(data));
}
