import { createExecutor } from "../executor/runner.js";
import { fileExists } from "../editor/file-ops.js";

async function canRun(
  executor: ReturnType<typeof createExecutor>,
  command: string
): Promise<boolean> {
  const result = await executor.run(command);
  return result.exitCode === 0;
}

export async function runLinter(
  projectType: string,
  executor: ReturnType<typeof createExecutor>
): Promise<{ stage: string; passed: boolean; errors: string[]; warnings: string[]; durationMs: number }> {
  const start = Date.now();
  const py = process.platform === "win32" ? "python" : "python3";

  let command: string | null = null;

  switch (projectType) {
    case "node":
      if (await fileExists("eslint.config.js") || await fileExists(".eslintrc.js") || await fileExists(".eslintrc.json")) {
        command = "npx eslint . --max-warnings=0";
      }
      break;

    case "python":
      if (await canRun(executor, `${py} -m ruff --version`)) {
        command = `${py} -m ruff check python`;
      } else if (await canRun(executor, `${py} -m flake8 --version`)) {
        command = `${py} -m flake8 python`;
      }
      break;
  }

  if (!command) {
    return { stage: "lint", passed: true, errors: [], warnings: ["No linter configured"], durationMs: Date.now() - start };
  }

  const result = await executor.run(command);
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");

  return {
    stage: "lint",
    passed: result.exitCode === 0,
    errors: result.exitCode === 0 ? [] : output.split("\n").filter(Boolean),
    warnings: [],
    durationMs: Date.now() - start,
  };
}
