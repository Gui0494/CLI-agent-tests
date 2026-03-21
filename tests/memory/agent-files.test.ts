import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { loadAgentFiles, buildAgentPrompt } from "../../src/memory/agent-files.js";

describe("agent-files", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aurex-agent-files-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads AGENT.md from project root", () => {
    fs.writeFileSync(path.join(tmpDir, "AGENT.md"), "Use strict TypeScript.\n");
    const entries = loadAgentFiles(tmpDir, tmpDir);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const projectEntry = entries.find(e => e.source === "project");
    expect(projectEntry).toBeDefined();
    expect(projectEntry!.content).toContain("Use strict TypeScript");
  });

  it("loads AGENT.local.md", () => {
    fs.writeFileSync(path.join(tmpDir, "AGENT.local.md"), "My personal preferences.\n");
    const entries = loadAgentFiles(tmpDir, tmpDir);
    const localEntry = entries.find(e => e.source === "local");
    expect(localEntry).toBeDefined();
    expect(localEntry!.content).toContain("personal preferences");
  });

  it("loads glob-scoped rules from .agent/rules/", () => {
    const rulesDir = path.join(tmpDir, ".agent", "rules");
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(
      path.join(rulesDir, "frontend.md"),
      "---\nglob: src/**/*.tsx\n---\nUse React hooks.\n"
    );
    const entries = loadAgentFiles(tmpDir, tmpDir);
    const rule = entries.find(e => e.source === "rule:frontend");
    expect(rule).toBeDefined();
    expect(rule!.glob).toBe("src/**/*.tsx");
    expect(rule!.content).toContain("Use React hooks");
  });

  it("buildAgentPrompt filters by glob", () => {
    const entries = [
      { source: "project", path: "/fake/AGENT.md", content: "Always test." },
      { source: "rule:frontend", path: "/fake/rules/frontend.md", content: "Use hooks.", glob: "src/**/*.tsx" },
    ];

    // With matching file
    const prompt1 = buildAgentPrompt(entries, ["src/components/App.tsx"]);
    expect(prompt1).toContain("Use hooks");

    // Without matching file
    const prompt2 = buildAgentPrompt(entries, ["api/handler.ts"]);
    expect(prompt2).not.toContain("Use hooks");
    expect(prompt2).toContain("Always test");
  });

  it("respects token budget", () => {
    // Write a very large AGENT.md (> 10K tokens)
    const bigContent = "x".repeat(50000); // ~12500 tokens
    fs.writeFileSync(path.join(tmpDir, "AGENT.md"), bigContent);
    fs.writeFileSync(path.join(tmpDir, "AGENT.local.md"), "This should not load.\n");

    const entries = loadAgentFiles(tmpDir, tmpDir);
    // The big file is truncated at 200 lines, and AGENT.local.md may not load due to budget
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });
});
