import { createExecutor } from "../executor/runner.js";
import { fileExists } from "../editor/file-ops.js";
import { runLinter } from "./linter.js";
import { runTypecheck } from "./typecheck.js";
import { runE2e } from "./e2e.js";

export interface VerifierConfig {
  skipE2e?: boolean;
  workDir?: string;
}

export interface StageResult {
  stage: string;
  passed: boolean;
  errors: string[];
  warnings: string[];
  durationMs: number;
}

export function createVerifier(config: VerifierConfig = {}) {
  const executor = createExecutor({ useSandbox: false });

  return {
    async runPipeline(): Promise<StageResult[]> {
      const results: StageResult[] = [];
      const projectType = await detectProjectType();

      // 1. Unit Tests
      results.push(await runTests(projectType, executor));

      // 2. Linting
      results.push(await runLinter(projectType, executor));

      // 3. Type checking
      results.push(await runTypecheck(projectType, executor));

      // 4. E2E (optional)
      if (!config.skipE2e) {
        results.push(await runE2e(executor));
      }

      return results;
    },

    async runStage(stage: string): Promise<StageResult> {
      const projectType = await detectProjectType();
      switch (stage) {
        case "test":
          return runTests(projectType, executor);
        case "lint":
          return runLinter(projectType, executor);
        case "typecheck":
          return runTypecheck(projectType, executor);
        case "e2e":
          return runE2e(executor);
        default:
          return { stage, passed: false, errors: [`Unknown stage: ${stage}`], warnings: [], durationMs: 0 };
      }
    },
  };
}

type ProjectType = "node" | "python" | "hybrid" | "unknown";

async function detectProjectType(): Promise<ProjectType> {
  const hasNode = await fileExists("package.json");
  const hasPython =
    await fileExists("python/pyproject.toml") ||
    await fileExists("pyproject.toml") ||
    await fileExists("setup.py");

  if (hasNode && hasPython) return "hybrid";
  if (hasNode) return "node";
  if (hasPython) return "python";
  return "unknown";
}

async function runCommandStage(
  stage: string,
  command: string,
  executor: ReturnType<typeof createExecutor>
): Promise<StageResult> {
  const start = Date.now();
  const result = await executor.run(command);
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");

  return {
    stage,
    passed: result.exitCode === 0,
    errors: result.exitCode === 0 ? [] : output.split("\n").filter(Boolean),
    warnings: [],
    durationMs: Date.now() - start,
  };
}

function mergeStage(stage: string, parts: StageResult[]): StageResult {
  return {
    stage,
    passed: parts.every((p) => p.passed),
    errors: parts.flatMap((p) => p.errors),
    warnings: parts.flatMap((p) => p.warnings),
    durationMs: parts.reduce((sum, p) => sum + p.durationMs, 0),
  };
}

async function runTests(
  projectType: ProjectType,
  executor: ReturnType<typeof createExecutor>
): Promise<StageResult> {
  const py = process.platform === "win32" ? "python" : "python3";

  switch (projectType) {
    case "node":
      return runCommandStage("tests", "npm test -- --passWithNoTests", executor);

    case "python":
      return runCommandStage("tests", `${py} -m pytest -q python/tests`, executor);

    case "hybrid": {
      const [nodeResult, pythonResult] = await Promise.all([
        runCommandStage("tests:node", "npm test -- --passWithNoTests", executor),
        runCommandStage("tests:python", `${py} -m pytest -q python/tests`, executor),
      ]);
      return mergeStage("tests", [nodeResult, pythonResult]);
    }

    default:
      return { stage: "tests", passed: true, errors: [], warnings: ["No project detected"], durationMs: 0 };
  }
}
