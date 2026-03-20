import { createExecutor } from "../executor/runner.js";
import { fileExists, readFile } from "../editor/file-ops.js";

async function canRun(
  executor: ReturnType<typeof createExecutor>,
  command: string
): Promise<boolean> {
  const result = await executor.run(command);
  return result.exitCode === 0;
}

async function hasNpmScript(
  _executor: ReturnType<typeof createExecutor>,
  scriptName: string
): Promise<boolean> {
  try {
    const pkg = JSON.parse(await readFile("package.json"));
    return !!(pkg.scripts && pkg.scripts[scriptName]);
  } catch {
    return false;
  }
}

export async function runTypecheck(
  projectType: string,
  executor: ReturnType<typeof createExecutor>
): Promise<{ stage: string; passed: boolean; errors: string[]; warnings: string[]; durationMs: number }> {
  const start = Date.now();
  const py = process.platform === "win32" ? "python" : "python3";

  let command: string | null = null;

  switch (projectType) {
    case "node":
      if (await hasNpmScript(executor, "typecheck")) {
        command = "npm run typecheck";
      } else if (await fileExists("tsconfig.json")) {
        command = "npx tsc --noEmit";
      }
      break;

    case "python":
      if (await canRun(executor, `${py} -m mypy --version`)) {
        command = `${py} -m mypy python`;
      } else if (await canRun(executor, `${py} -m pyright --version`)) {
        command = `${py} -m pyright python`;
      }
      break;

    case "hybrid": {
      let nodeCmd: string | null = null;
      let pyCmd: string | null = null;

      if (await hasNpmScript(executor, "typecheck")) {
        nodeCmd = "npm run typecheck";
      } else if (await fileExists("tsconfig.json")) {
        nodeCmd = "npx tsc --noEmit";
      }

      if (await canRun(executor, `${py} -m mypy --version`)) {
        pyCmd = `${py} -m mypy python`;
      } else if (await canRun(executor, `${py} -m pyright --version`)) {
        pyCmd = `${py} -m pyright python`;
      }

      if (nodeCmd && pyCmd) {
        command = `${nodeCmd} && ${pyCmd}`;
      } else {
        command = nodeCmd || pyCmd;
      }
      break;
    }
  }

  if (!command) {
    return { stage: "typecheck", passed: true, errors: [], warnings: ["No type checker configured"], durationMs: Date.now() - start };
  }

  const result = await executor.run(command);
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");

  return {
    stage: "typecheck",
    passed: result.exitCode === 0,
    errors: result.exitCode === 0 ? [] : output.split("\n").filter(Boolean),
    warnings: [],
    durationMs: Date.now() - start,
  };
}
