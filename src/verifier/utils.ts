import { createExecutor } from "../executor/runner.js";
import { readFile } from "../editor/file-ops.js";

export async function canRun(
  executor: ReturnType<typeof createExecutor>,
  command: string
): Promise<boolean> {
  const result = await executor.run(command);
  return result.exitCode === 0;
}

export async function hasNpmScript(
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
