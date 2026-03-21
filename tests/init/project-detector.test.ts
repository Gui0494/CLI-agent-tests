import { detectProject } from "../../src/init/project-detector.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("detectProject", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aurex-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("detects Node.js + TypeScript project", async () => {
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        name: "test-project",
        scripts: { test: "jest", build: "tsc", lint: "eslint ." },
        dependencies: { express: "^4.0.0" },
        devDependencies: { typescript: "^5.0.0", jest: "^29.0.0" },
      }),
    );
    await fs.writeFile(path.join(tmpDir, "tsconfig.json"), "{}");
    await fs.mkdir(path.join(tmpDir, "src"));

    const project = await detectProject(tmpDir);
    expect(project.stack).toContain("node");
    expect(project.stack).toContain("typescript");
    expect(project.stack).toContain("express");
    expect(project.stack).toContain("jest");
    expect(project.testCommand).toBe("npm test");
    expect(project.buildCommand).toBe("npm run build");
    expect(project.srcDirs).toContain("src");
  });

  test("detects Python project", async () => {
    await fs.writeFile(path.join(tmpDir, "pyproject.toml"), "[tool.pytest]");
    await fs.mkdir(path.join(tmpDir, "src"));

    const project = await detectProject(tmpDir);
    expect(project.stack).toContain("python");
    expect(project.testCommand).toBe("pytest");
  });

  test("detects pnpm package manager", async () => {
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "test" }),
    );
    await fs.writeFile(path.join(tmpDir, "pnpm-lock.yaml"), "");

    const project = await detectProject(tmpDir);
    expect(project.packageManager).toBe("pnpm");
  });

  test("handles empty directory", async () => {
    const project = await detectProject(tmpDir);
    expect(project.stack).toEqual([]);
    expect(project.packageManager).toBe("npm");
  });

  test("detects eslint style", async () => {
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "test" }),
    );
    await fs.writeFile(path.join(tmpDir, ".eslintrc.json"), "{}");

    const project = await detectProject(tmpDir);
    expect(project.conventions.style).toBe("eslint");
  });
});
