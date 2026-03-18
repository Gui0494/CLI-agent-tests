/**
 * Unit tests for SkillLoader
 */
import * as path from "path";
import * as fs from "fs/promises";
import { SkillLoader } from "../../src/skills/loader.js";

// Create a temp skill file for testing
const TEMP_DIR = path.join(process.cwd(), ".tmp-test-skills");
const SAMPLE_YAML = `
name: test-skill
version: "1.0"
description: A test skill for unit testing

trigger:
  manual: true
  auto: true
  patterns:
    - "test"
    - "testing"

required_tools:
  - shell

inputs:
  - name: filter
    type: string
    required: false
    description: "Test filter"

outputs:
  - name: results
    type: object
    description: "Test results"

steps:
  - id: step_1
    action: "Run tests"
    tool: shell
    command: "npm test {{filter}}"
    on_error: abort

limits:
  max_duration: 60s
  max_tool_calls: 5
  requires_approval: false
`;

describe("SkillLoader", () => {
  beforeAll(async () => {
    await fs.mkdir(TEMP_DIR, { recursive: true });
    await fs.writeFile(path.join(TEMP_DIR, "test-skill.yaml"), SAMPLE_YAML);
  });

  afterAll(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("loads skills from directory", async () => {
    const loader = new SkillLoader([TEMP_DIR]);
    await loader.loadAll();
    expect(loader.getAll()).toHaveLength(1);
  });

  it("parses YAML correctly", async () => {
    const loader = new SkillLoader([TEMP_DIR]);
    await loader.loadAll();
    const skill = loader.get("test-skill");
    expect(skill).toBeDefined();
    expect(skill!.name).toBe("test-skill");
    expect(skill!.version).toBe("1.0");
    expect(skill!.trigger.manual).toBe(true);
    expect(skill!.trigger.auto).toBe(true);
    expect(skill!.trigger.patterns).toContain("test");
    expect(skill!.requiredTools).toContain("shell");
    expect(skill!.inputs).toHaveLength(1);
    expect(skill!.outputs).toHaveLength(1);
    expect(skill!.steps).toHaveLength(1);
    expect(skill!.steps[0].onError).toBe("abort");
    expect(skill!.limits.maxDuration).toBe(60);
  });

  it("checks availability correctly", async () => {
    const loader = new SkillLoader([TEMP_DIR]);
    await loader.loadAll();
    const skill = loader.get("test-skill")!;

    const available = loader.checkAvailability(skill, new Set(["shell"]));
    expect(available.available).toBe(true);
    expect(available.missingTools).toHaveLength(0);

    const unavailable = loader.checkAvailability(skill, new Set(["fs_read"]));
    expect(unavailable.available).toBe(false);
    expect(unavailable.missingTools).toContain("shell");
  });

  it("finds matching skills by pattern", async () => {
    const loader = new SkillLoader([TEMP_DIR]);
    await loader.loadAll();
    const matches = loader.findMatchingSkills("run tests now");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].name).toBe("test-skill");
  });

  it("returns empty for non-matching input", async () => {
    const loader = new SkillLoader([TEMP_DIR]);
    await loader.loadAll();
    const matches = loader.findMatchingSkills("deploy to production");
    expect(matches).toHaveLength(0);
  });

  it("handles non-existent directory gracefully", async () => {
    const loader = new SkillLoader(["/nonexistent/path"]);
    await loader.loadAll();
    expect(loader.getAll()).toHaveLength(0);
  });

  it("returns undefined for unknown skill", async () => {
    const loader = new SkillLoader([TEMP_DIR]);
    await loader.loadAll();
    expect(loader.get("nonexistent")).toBeUndefined();
  });
});
