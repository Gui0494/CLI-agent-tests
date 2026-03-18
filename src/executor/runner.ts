import { exec } from "child_process";
import { promisify } from "util";
import { runInSandbox, SandboxResult } from "./docker-sandbox.js";
import { withRetry, isTransientError } from "./retry.js";
import { config as appConfig } from "../config/loader.js";

const execAsync = promisify(exec);

export interface ExecutorConfig {
  timeoutMs?: number;
  useSandbox?: boolean;
  maxRetries?: number;
  workDir?: string;
  onLocalFallbackRequest?: (command: string) => Promise<boolean>;
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  attempts: number;
}

export function createExecutor(config: ExecutorConfig = {}) {
  const {
    timeoutMs = appConfig.executor.timeout_ms,
    useSandbox = true,
    maxRetries = appConfig.executor.max_retries,
    workDir
  } = config;

  return {
    async run(command: string): Promise<ExecutionResult> {
      let attempts = 0;

      const execute = async (): Promise<ExecutionResult> => {
        attempts++;

        if (useSandbox) {
          try {
            const result = await runInSandbox(command, {
              timeout: timeoutMs,
              workDir: workDir || "/workspace",
            });
            // Treat non-zero exit from dockerode run as error to trigger retry
            if (result.timedOut || result.exitCode > 128) {
              throw Object.assign(new Error("Container failed"), { killed: result.timedOut, code: result.exitCode });
            }
            return { ...result, attempts };
          } catch (err: any) {
            // If Docker failed completely (transient), we throw to retry
            if (isTransientError(err)) throw err;
            // Otherwise Fallback to local if Docker not available
            console.warn(`\n[executor] Sandbox unavailable or failed (${err.message}).`);
            if (config.onLocalFallbackRequest) {
              const approved = await config.onLocalFallbackRequest(command);
              if (!approved) {
                throw new Error("Sandbox failed and local execution was not approved.");
              }
            } else {
              throw new Error("Sandbox failed and local execution requires explicit approval.");
            }
            console.warn(`\nWARNING: Running command directly on your machine: ${command}\n`);
            return runLocal(command, timeoutMs, attempts, workDir);
          }
        }

        return runLocal(command, timeoutMs, attempts, workDir);
      };

      return withRetry(execute, { maxAttempts: maxRetries }, (err, _attempt) => {
        return isTransientError(err);
      });
    },

    async runLocal(command: string): Promise<ExecutionResult> {
      return runLocal(command, timeoutMs, 1, workDir);
    },
  };
}

async function runLocal(command: string, timeoutMs: number, attempts: number, workDir?: string): Promise<ExecutionResult> {
  const startTime = Date.now();

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      cwd: workDir || process.cwd(),
    });

    return {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode: 0,
      timedOut: false,
      durationMs: Date.now() - startTime,
      attempts,
    };
  } catch (err: any) {
    return {
      stdout: err.stdout?.trim() || "",
      stderr: err.stderr?.trim() || err.message,
      exitCode: err.code ?? 1,
      timedOut: err.killed || false,
      durationMs: Date.now() - startTime,
      attempts,
    };
  }
}
