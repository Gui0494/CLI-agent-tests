/**
 * Non-interactive mode detection.
 *
 * Detects TTY, CI, NO_COLOR environments and exports singletons
 * so that the rest of the CLI can adapt its behavior (disable spinners,
 * colors, interactive prompts) when running in pipes or CI.
 */

/** True when stdin AND stdout are attached to a terminal. */
export const isInteractive: boolean =
  Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);

/** True when running inside a CI environment. */
export const isCI: boolean =
  process.env.CI === "true" ||
  process.env.CI === "1" ||
  process.env.CONTINUOUS_INTEGRATION === "true" ||
  process.env.TF_BUILD === "True" ||          // Azure Pipelines
  Boolean(process.env.GITHUB_ACTIONS) ||
  Boolean(process.env.GITLAB_CI) ||
  Boolean(process.env.CIRCLECI) ||
  Boolean(process.env.JENKINS_URL);

/** True when color output should be suppressed (https://no-color.org/). */
export let noColor: boolean =
  "NO_COLOR" in process.env || process.env.TERM === "dumb";

/** Called from CLI entry point to apply --plain flag. */
export function setNoColor(value: boolean): void {
  noColor = value;
}

/** True when stdout is being piped (e.g. `aurex | head`). */
export const isPiped: boolean = !process.stdout.isTTY;
