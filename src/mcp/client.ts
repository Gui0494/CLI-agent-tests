/**
 * MCP Client — connects to MCP servers over stdio transport.
 *
 * Implements the Host/Client side of the Model Context Protocol:
 * - Spawns server processes via stdio
 * - Performs initialize handshake
 * - Lists and calls tools
 * - Manages lifecycle (start/stop)
 */

import { spawn, ChildProcess } from "child_process";
import {
  JsonRpcRequest,
  JsonRpcResponse,
  McpServerConfig,
  McpToolDefinition,
  McpToolResult,
  McpInitializeResult,
} from "./types.js";

export class McpClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private tools: McpToolDefinition[] = [];
  readonly serverName: string;

  constructor(
    private name: string,
    private config: McpServerConfig
  ) {
    this.serverName = name;
  }

  /** Start the server process and perform the MCP initialize handshake. */
  async start(): Promise<McpInitializeResult> {
    if (this.process) throw new Error(`MCP server '${this.name}' already started`);

    this.process = spawn(this.config.command, this.config.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...this.config.env },
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      // Suppress stderr unless debugging
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      this.buffer += data.toString("utf8");
      this.processBuffer();
    });

    this.process.on("exit", () => {
      for (const [, handler] of this.pending) {
        handler.reject(new Error(`MCP server '${this.name}' exited`));
      }
      this.pending.clear();
      this.process = null;
    });

    // Initialize handshake
    const initResult = await this.send<McpInitializeResult>("initialize", {
      protocolVersion: "2024-11-05",
      clientInfo: { name: "aurex-ai", version: "0.1.0" },
      capabilities: {},
    });

    // Send initialized notification
    this.notify("notifications/initialized", {});

    // List tools
    if (initResult.capabilities.tools) {
      const toolsResult = await this.send<{ tools: McpToolDefinition[] }>("tools/list", {});
      this.tools = toolsResult.tools ?? [];
    }

    return initResult;
  }

  /** Get the tools exposed by this server. */
  getTools(): McpToolDefinition[] {
    return [...this.tools];
  }

  /** Call a tool on the server. */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    return this.send<McpToolResult>("tools/call", { name, arguments: args });
  }

  /** Stop the server process. */
  stop(): void {
    if (this.process) {
      const p = this.process;
      this.process = null;
      try { p.kill("SIGTERM"); } catch { /* ignore */ }
      setTimeout(() => {
        try { p.kill("SIGKILL"); } catch { /* ignore */ }
      }, 2000).unref();
    }
  }

  // ─── Private ───────────────────────────────────────────

  private send<T>(method: string, params: Record<string, unknown>): Promise<T> {
    if (!this.process?.stdin) throw new Error(`MCP server '${this.name}' not started`);

    const id = ++this.requestId;
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request '${method}' timed out`));
      }, 30000);

      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timeout); resolve(value as T); },
        reject: (error) => { clearTimeout(timeout); reject(error); },
      });

      this.process!.stdin!.write(JSON.stringify(request) + "\n");
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    if (!this.process?.stdin) return;
    const notification = { jsonrpc: "2.0", method, params };
    this.process.stdin.write(JSON.stringify(notification) + "\n");
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed) as JsonRpcResponse;
        if (parsed.id !== undefined) {
          const handler = this.pending.get(parsed.id as number);
          if (handler) {
            this.pending.delete(parsed.id as number);
            if (parsed.error) {
              handler.reject(new Error(parsed.error.message));
            } else {
              handler.resolve(parsed.result);
            }
          }
        }
      } catch {
        // Not valid JSON-RPC
      }
    }
  }
}
