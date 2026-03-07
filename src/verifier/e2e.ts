import { createExecutor } from "../executor/runner.js";
import { fileExists } from "../editor/file-ops.js";

export async function runE2e(
  executor: ReturnType<typeof createExecutor>
): Promise<{ stage: string; passed: boolean; errors: string[]; warnings: string[]; durationMs: number }> {
  const start = Date.now();

  // Check for Playwright
  if (await fileExists("playwright.config.ts") || await fileExists("playwright.config.js")) {
    const result = await executor.run("npx playwright test --reporter=line 2>&1");
    const passed = result.exitCode === 0;
    return {
      stage: "e2e",
      passed,
      errors: passed ? [] : result.stdout.split("\n").filter(Boolean),
      warnings: [],
      durationMs: Date.now() - start,
    };
  }

  // Check for Cypress
  if (await fileExists("cypress.config.ts") || await fileExists("cypress.config.js")) {
    const result = await executor.run("npx cypress run --headless 2>&1");
    const passed = result.exitCode === 0;
    return {
      stage: "e2e",
      passed,
      errors: passed ? [] : result.stdout.split("\n").filter(Boolean),
      warnings: [],
      durationMs: Date.now() - start,
    };
  }

  return { stage: "e2e", passed: true, errors: [], warnings: ["No e2e framework found"], durationMs: 0 };
}
