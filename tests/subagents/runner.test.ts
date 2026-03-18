/**
 * Unit tests for SubagentRunner and definitions
 */
import {
  SubagentName,
  SUBAGENT_DEFINITIONS,
  SubagentTask,
} from "../../src/subagents/definitions.js";
import { SubagentRunner } from "../../src/subagents/runner.js";
import { jest } from "@jest/globals";

describe("SUBAGENT_DEFINITIONS", () => {
  it("should have 4 definitions", () => {
    const names = Object.keys(SUBAGENT_DEFINITIONS);
    expect(names).toHaveLength(4);
    expect(names).toContain("security-reviewer");
    expect(names).toContain("architecture-reviewer");
    expect(names).toContain("researcher");
    expect(names).toContain("bug-investigator");
  });

  it("each definition has required fields", () => {
    for (const def of Object.values(SUBAGENT_DEFINITIONS)) {
      expect(def.name).toBeTruthy();
      expect(def.specialty).toBeTruthy();
      expect(def.systemPrompt).toBeTruthy();
      expect(def.tools.length).toBeGreaterThan(0);
      expect(def.maxTokens).toBeGreaterThan(0);
    }
  });

  it("security-reviewer has read-only tools", () => {
    const def = SUBAGENT_DEFINITIONS["security-reviewer"];
    expect(def.tools).toContain("fs_read");
    expect(def.tools).toContain("fs_grep");
  });

  it("researcher has web tools", () => {
    const def = SUBAGENT_DEFINITIONS["researcher"];
    expect(def.tools).toContain("web_search");
    expect(def.tools).toContain("web_fetch");
  });
});

describe("SubagentRunner", () => {
  let runner: SubagentRunner;

  const mockExecutor = {
    readFile: jest.fn<any>().mockResolvedValue("const x = 1;"),
    listFiles: jest.fn<any>().mockResolvedValue(["src/index.ts", "src/app.ts"]),
    grep: jest.fn<any>().mockResolvedValue([]),
    runCommand: jest.fn<any>().mockResolvedValue({ exitCode: 0, stdout: "ok", stderr: "" }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    runner = new SubagentRunner({ toolExecutor: mockExecutor });
  });

  it("returns error for unknown subagent", async () => {
    const result = await runner.run("unknown" as SubagentName, {
      task: "test",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("não encontrado");
  });

  it("runs security-reviewer deterministically", async () => {
    const result = await runner.run("security-reviewer", {
      task: "Revisar segurança",
      files: ["src/index.ts"],
    });
    expect(result.success).toBe(true);
    expect(result.subagent).toBe("security-reviewer");
    expect(result.result).toBeDefined();
    expect(result.result!.type).toBe("security-review");
  });

  it("runs architecture-reviewer deterministically", async () => {
    const result = await runner.run("architecture-reviewer", {
      task: "Revisar arquitetura",
    });
    expect(result.success).toBe(true);
    expect(result.result!.type).toBe("architecture-review");
  });

  it("runs researcher with partial result (no LLM)", async () => {
    const result = await runner.run("researcher", {
      task: "Pesquisar React 19",
    });
    expect(result.success).toBe(true);
    expect(result.result!.type).toBe("research");
  });

  it("runs bug-investigator with stack trace", async () => {
    mockExecutor.readFile.mockResolvedValue("line1\nline2\nline3\nbuggy line\nline5");

    const result = await runner.run("bug-investigator", {
      task: "Bug no checkout",
      error: "NaN",
      stackTrace: "at calculateTotal (src/cart.ts:4)",
    });
    expect(result.success).toBe(true);
    expect(result.result!.type).toBe("bug-investigation");
  });

  it("lists available subagents", () => {
    const list = SubagentRunner.listSubagents();
    expect(list).toHaveLength(4);
  });

  it("formats subagent list", () => {
    const formatted = SubagentRunner.formatList();
    expect(formatted).toContain("security-reviewer");
    expect(formatted).toContain("researcher");
  });

  it("uses LLM when available", async () => {
    const llmRunner = new SubagentRunner({
      toolExecutor: mockExecutor,
      llmCall: jest.fn<any>().mockResolvedValue('{"summary": "test result"}'),
    });

    const result = await llmRunner.run("researcher", {
      task: "Pesquisar algo",
    });
    expect(result.success).toBe(true);
  });
});
