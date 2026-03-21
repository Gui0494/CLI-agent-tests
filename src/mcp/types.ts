/**
 * MCP (Model Context Protocol) type definitions.
 *
 * JSON-RPC 2.0 based protocol for connecting LLM applications
 * to external tool servers.
 */

// ─── JSON-RPC 2.0 ───────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

// ─── MCP Tool ────────────────────────────────────────────

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpToolResult {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  isError?: boolean;
}

// ─── MCP Server Config ───────────────────────────────────

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

// ─── MCP Capabilities ────────────────────────────────────

export interface McpServerCapabilities {
  tools?: Record<string, never>;
  resources?: Record<string, never>;
  prompts?: Record<string, never>;
}

export interface McpInitializeResult {
  protocolVersion: string;
  serverInfo: { name: string; version: string };
  capabilities: McpServerCapabilities;
}
