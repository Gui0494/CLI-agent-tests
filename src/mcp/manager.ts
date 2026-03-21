/**
 * MCP Manager — manages multiple MCP server connections.
 *
 * Reads server configs from config.yaml or .agent/mcp.json,
 * starts servers on session init, and provides a unified
 * interface to list and call tools across all servers.
 */

import * as fs from "fs";
import * as path from "path";
import { McpClient } from "./client.js";
import { McpServerConfig, McpToolDefinition } from "./types.js";

export interface McpToolWithServer extends McpToolDefinition {
  serverName: string;
}

export class McpManager {
  private clients = new Map<string, McpClient>();

  /** Start all configured MCP servers. */
  async startAll(configs: Record<string, McpServerConfig>): Promise<void> {
    const startPromises = Object.entries(configs).map(async ([name, config]) => {
      const client = new McpClient(name, config);
      try {
        await client.start();
        this.clients.set(name, client);
      } catch (err: any) {
        console.error(`[mcp] Failed to start server '${name}': ${err.message}`);
      }
    });
    await Promise.all(startPromises);
  }

  /** Get all tools across all connected servers. */
  getAllTools(): McpToolWithServer[] {
    const tools: McpToolWithServer[] = [];
    for (const [serverName, client] of this.clients) {
      for (const tool of client.getTools()) {
        tools.push({ ...tool, serverName });
      }
    }
    return tools;
  }

  /** Call a tool, routing to the correct server. */
  async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ content: string; isError?: boolean }> {
    for (const [, client] of this.clients) {
      const tool = client.getTools().find(t => t.name === toolName);
      if (tool) {
        const result = await client.callTool(toolName, args);
        const text = result.content
          .filter(c => c.type === "text")
          .map(c => (c as { type: "text"; text: string }).text)
          .join("\n");
        return { content: text, isError: result.isError };
      }
    }
    return { content: `Tool '${toolName}' not found on any MCP server`, isError: true };
  }

  /** Stop all MCP servers. */
  stopAll(): void {
    for (const [, client] of this.clients) {
      client.stop();
    }
    this.clients.clear();
  }

  /** Load MCP server configs from .agent/mcp.json or config.yaml. */
  static loadConfigs(projectRoot: string = process.cwd()): Record<string, McpServerConfig> {
    // Try .agent/mcp.json first
    const mcpJsonPath = path.join(projectRoot, ".agent", "mcp.json");
    if (fs.existsSync(mcpJsonPath)) {
      try {
        const raw = fs.readFileSync(mcpJsonPath, "utf-8");
        const parsed = JSON.parse(raw);
        return parsed.servers ?? parsed ?? {};
      } catch {
        // Invalid JSON
      }
    }

    return {};
  }

  get serverCount(): number {
    return this.clients.size;
  }
}
