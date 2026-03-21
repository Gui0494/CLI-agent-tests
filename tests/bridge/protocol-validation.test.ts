/**
 * Unit tests for JSON-RPC protocol schema validation
 */
import {
  validateMethodParams,
  RpcMethodSchemas,
  parseIncomingRequest,
} from "../../src/bridge/protocol.js";

describe("RPC Method Schema Validation", () => {
  describe("validateMethodParams", () => {
    it("rejects unknown methods (default-deny)", () => {
      expect(() => validateMethodParams("evil_method", {})).toThrow("Unknown RPC method");
    });

    it("validates search params", () => {
      const result = validateMethodParams("search", { query: "test query" });
      expect(result).toHaveProperty("query", "test query");
    });

    it("rejects search with empty query", () => {
      expect(() => validateMethodParams("search", { query: "" })).toThrow();
    });

    it("rejects search with oversized query", () => {
      expect(() => validateMethodParams("search", { query: "x".repeat(10_001) })).toThrow();
    });

    it("validates fetch_url params", () => {
      const result = validateMethodParams("fetch_url", { url: "https://example.com" });
      expect(result).toHaveProperty("url", "https://example.com");
    });

    it("rejects fetch_url with invalid URL", () => {
      expect(() => validateMethodParams("fetch_url", { url: "not-a-url" })).toThrow();
    });

    it("validates agent_run params", () => {
      const result = validateMethodParams("agent_run", {
        user_input: "fix the bug",
        max_steps: 5,
      });
      expect(result).toHaveProperty("user_input", "fix the bug");
      expect(result).toHaveProperty("max_steps", 5);
    });

    it("rejects agent_run with max_steps > 50", () => {
      expect(() =>
        validateMethodParams("agent_run", { user_input: "test", max_steps: 100 })
      ).toThrow();
    });

    it("rejects agent_run with empty input", () => {
      expect(() =>
        validateMethodParams("agent_run", { user_input: "" })
      ).toThrow();
    });

    it("validates execute_tool params", () => {
      const result = validateMethodParams("execute_tool", {
        name: "read_file",
        params: { path: "/foo" },
      });
      expect(result).toHaveProperty("name", "read_file");
    });

    it("rejects execute_tool with invalid tool name format", () => {
      expect(() =>
        validateMethodParams("execute_tool", { name: "../../../etc/passwd" })
      ).toThrow();
    });

    it("validates run_node_tool params", () => {
      const result = validateMethodParams("run_node_tool", {
        tool_name: "read_file",
        tool_args: { path: "foo.ts" },
      });
      expect(result).toHaveProperty("tool_name", "read_file");
    });

    it("rejects run_node_tool with invalid tool_name", () => {
      expect(() =>
        validateMethodParams("run_node_tool", {
          tool_name: "rm -rf /",
          tool_args: {},
        })
      ).toThrow();
    });

    it("validates manage_history params", () => {
      const result = validateMethodParams("manage_history", { action: "clear" });
      expect(result).toHaveProperty("action", "clear");
    });

    it("rejects manage_history with invalid action", () => {
      expect(() =>
        validateMethodParams("manage_history", { action: "drop_tables" })
      ).toThrow();
    });

    it("validates llm_chat params", () => {
      const result = validateMethodParams("llm_chat", {
        messages: [{ role: "user", content: "hello" }],
      });
      expect(result).toHaveProperty("messages");
    });

    it("rejects llm_chat with empty messages", () => {
      expect(() =>
        validateMethodParams("llm_chat", { messages: [] })
      ).toThrow();
    });

    it("validates permission_request params", () => {
      const result = validateMethodParams("permission_request", {
        action: "write_file",
        risk_level: "medium",
      });
      expect(result).toHaveProperty("action", "write_file");
    });
  });

  describe("parseIncomingRequest", () => {
    it("parses valid request", () => {
      const json = JSON.stringify({
        jsonrpc: "2.0",
        method: "run_node_tool",
        params: { tool_name: "read_file", tool_args: {} },
        id: 1,
      });
      const result = parseIncomingRequest(json);
      expect(result.method).toBe("run_node_tool");
      expect(result.id).toBe(1);
    });

    it("rejects request without method", () => {
      const json = JSON.stringify({ jsonrpc: "2.0", params: {}, id: 1 });
      expect(() => parseIncomingRequest(json)).toThrow();
    });

    it("rejects request with wrong jsonrpc version", () => {
      const json = JSON.stringify({
        jsonrpc: "1.0",
        method: "test",
        params: {},
        id: 1,
      });
      expect(() => parseIncomingRequest(json)).toThrow();
    });
  });
});
