/**
 * project-detector.ts — Smart project detection for AurexAI CLI Agent.
 *
 * Analyzes workspace files to detect stack, frameworks, test runners,
 * and conventions. Used by /init command to generate .aurex/project.yaml.
 *
 * Reference: Phase 4.2 — Project Initialization Intelligence
 */

import fs from "fs/promises";
import path from "path";

export interface DetectedProject {
  name: string;
  stack: string[];
  packageManager: "npm" | "yarn" | "pnpm" | "bun";
  testCommand: string;
  buildCommand: string;
  lintCommand: string;
  entryPoints: string[];
  srcDirs: string[];
  conventions: {
    style: string;
    testPattern: string;
    importStyle: string;
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe(filePath: string): Promise<Record<string, any> | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function detectProject(rootDir?: string): Promise<DetectedProject> {
  const root = rootDir || process.cwd();
  const stack: string[] = [];
  let packageManager: DetectedProject["packageManager"] = "npm";
  let testCommand = "";
  let buildCommand = "";
  let lintCommand = "";
  const entryPoints: string[] = [];
  const srcDirs: string[] = [];
  let style = "";
  let testPattern = "";
  let importStyle = "esm";

  // Detect name from directory
  const name = path.basename(root);

  // Check package.json
  const pkg = await readJsonSafe(path.join(root, "package.json"));
  if (pkg) {
    stack.push("node");
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps?.typescript) stack.push("typescript");
    if (deps?.react) stack.push("react");
    if (deps?.next) stack.push("next");
    if (deps?.vue) stack.push("vue");
    if (deps?.express) stack.push("express");
    if (deps?.jest) stack.push("jest");
    if (deps?.vitest) stack.push("vitest");
    if (deps?.mocha) stack.push("mocha");

    // Test command
    if (pkg.scripts?.test) testCommand = `npm test`;
    // Build command
    if (pkg.scripts?.build) buildCommand = `npm run build`;
    // Lint command
    if (pkg.scripts?.lint) lintCommand = `npm run lint`;

    // Entry points
    if (pkg.main) entryPoints.push(pkg.main);
    if (pkg.module) entryPoints.push(pkg.module);

    // Module type
    if (pkg.type === "module") importStyle = "esm";
    else if (pkg.type === "commonjs") importStyle = "cjs";
  }

  // Check for Python
  const hasPyproject = await fileExists(path.join(root, "pyproject.toml"));
  const hasRequirements = await fileExists(path.join(root, "requirements.txt"));
  if (hasPyproject || hasRequirements) {
    stack.push("python");
    if (!testCommand) testCommand = "pytest";
  }

  // Check for Go
  if (await fileExists(path.join(root, "go.mod"))) {
    stack.push("go");
    if (!testCommand) testCommand = "go test ./...";
    if (!buildCommand) buildCommand = "go build ./...";
  }

  // Check for Rust
  if (await fileExists(path.join(root, "Cargo.toml"))) {
    stack.push("rust");
    if (!testCommand) testCommand = "cargo test";
    if (!buildCommand) buildCommand = "cargo build";
  }

  // Package manager detection
  if (await fileExists(path.join(root, "bun.lockb"))) packageManager = "bun";
  else if (await fileExists(path.join(root, "pnpm-lock.yaml"))) packageManager = "pnpm";
  else if (await fileExists(path.join(root, "yarn.lock"))) packageManager = "yarn";

  // Style detection
  for (const f of [".eslintrc.json", ".eslintrc.js", ".eslintrc.yml", ".eslintrc"]) {
    if (await fileExists(path.join(root, f))) { style = "eslint"; break; }
  }
  if (!style && await fileExists(path.join(root, ".prettierrc"))) style = "prettier";

  // Test pattern detection
  if (stack.includes("jest") || stack.includes("vitest")) {
    testPattern = "**/*.test.{ts,tsx,js,jsx}";
  } else if (stack.includes("mocha")) {
    testPattern = "test/**/*.{ts,js}";
  } else if (stack.includes("python")) {
    testPattern = "tests/test_*.py";
  }

  // Source directories
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory() && ["src", "lib", "app", "python", "pkg", "internal", "cmd"].includes(e.name)) {
      srcDirs.push(e.name);
    }
  }

  return {
    name,
    stack,
    packageManager,
    testCommand: testCommand || "echo 'No test command configured'",
    buildCommand: buildCommand || "",
    lintCommand: lintCommand || "",
    entryPoints,
    srcDirs,
    conventions: { style, testPattern, importStyle },
  };
}
