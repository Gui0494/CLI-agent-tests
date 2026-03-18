/**
 * on-session-start.ts — Doctor/healthcheck hook
 *
 * Runs at session start to verify tool availability and system health.
 * Results are stored in SessionMemory.doctorResult and used to filter
 * available tools in the agent loop.
 *
 * Reference: docs/architecture-reference/hooks/on-session-start.md
 */

import chalk from "chalk";
import { DoctorCheck, DoctorResult } from "../../memory/session.js";

// ─── Check Registry ──────────────────────────────────────

export interface DoctorCheckFn {
  name: string;
  description: string;
  check: () => Promise<DoctorCheck>;
}

const DOCTOR_CHECKS: DoctorCheckFn[] = [
  {
    name: "node",
    description: "Node.js runtime",
    check: async () => ({
      name: "node",
      status: "ok",
      message: `Node.js ${process.version}`,
      lastChecked: Date.now(),
    }),
  },
  {
    name: "python",
    description: "Python runtime",
    check: async () => {
      const py = process.platform === "win32" ? "python" : "python3";
      try {
        const { execSync } = await import("child_process");
        const version = execSync(`${py} --version`, { encoding: "utf-8", timeout: 5000 }).trim();
        return { name: "python", status: "ok", message: version, lastChecked: Date.now() };
      } catch {
        return { name: "python", status: "warn", message: "Python não encontrado — bridge Python indisponível", lastChecked: Date.now() };
      }
    },
  },
  {
    name: "git",
    description: "Git CLI",
    check: async () => {
      try {
        const { execSync } = await import("child_process");
        const version = execSync("git --version", { encoding: "utf-8", timeout: 5000 }).trim();
        return { name: "git", status: "ok", message: version, lastChecked: Date.now() };
      } catch {
        return { name: "git", status: "warn", message: "Git não encontrado — operações git indisponíveis", lastChecked: Date.now() };
      }
    },
  },
  {
    name: "docker",
    description: "Docker (sandbox)",
    check: async () => {
      try {
        const { execSync } = await import("child_process");
        const version = execSync("docker --version", { encoding: "utf-8", timeout: 5000 }).trim();
        // Also check Docker daemon is running
        execSync("docker info", { encoding: "utf-8", timeout: 5000, stdio: "pipe" });
        return { name: "docker", status: "ok", message: version, lastChecked: Date.now() };
      } catch (e: unknown) {
        const err = e as any;
        if (err.message?.includes("Cannot connect") || err.stderr?.includes("daemon")) {
          return { name: "docker", status: "warn", message: "Docker instalado mas daemon não está rodando — sandbox indisponível", lastChecked: Date.now() };
        }
        return { name: "docker", status: "warn", message: "Docker não encontrado — sandbox indisponível, comandos executam localmente", lastChecked: Date.now() };
      }
    },
  },
  {
    name: "typescript",
    description: "TypeScript compiler",
    check: async () => {
      try {
        const { execSync } = await import("child_process");
        const version = execSync("npx tsc --version", { encoding: "utf-8", timeout: 10000 }).trim();
        return { name: "typescript", status: "ok", message: version, lastChecked: Date.now() };
      } catch {
        return { name: "typescript", status: "warn", message: "TypeScript não encontrado", lastChecked: Date.now() };
      }
    },
  },
  {
    name: "api-key",
    description: "API key configurada",
    check: async () => {
      const keys = [
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "GEMINI_API_KEY",
      ];
      const found = keys.filter(k => !!process.env[k]);
      if (found.length > 0) {
        return {
          name: "api-key",
          status: "ok",
          message: `Chaves encontradas: ${found.join(', ')}`,
          lastChecked: Date.now(),
        };
      }
      return {
        name: "api-key",
        status: "error",
        message: "Nenhuma API key configurada (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY)",
        lastChecked: Date.now(),
      };
    },
  },
  {
    name: "workspace",
    description: "Workspace válido",
    check: async () => {
      try {
        const fs = await import("fs/promises");
        const pkgExists = await fs.access("package.json").then(() => true).catch(() => false);
        const gitExists = await fs.access(".git").then(() => true).catch(() => false);
        const parts = [];
        if (pkgExists) parts.push("package.json ✓");
        if (gitExists) parts.push("git repo ✓");
        if (parts.length === 0) {
          return { name: "workspace", status: "warn", message: "Nenhum package.json ou .git encontrado", lastChecked: Date.now() };
        }
        return { name: "workspace", status: "ok", message: parts.join(", "), lastChecked: Date.now() };
      } catch {
        return { name: "workspace", status: "error", message: "Erro ao verificar workspace", lastChecked: Date.now() };
      }
    },
  },
];

// ─── Doctor Runner ───────────────────────────────────────

export async function runDoctor(_verbose: boolean = false): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];

  for (const check of DOCTOR_CHECKS) {
    try {
      const result = await check.check();
      checks.push(result);
    } catch (err: unknown) {
      checks.push({
        name: check.name,
        status: "error",
        message: `Check failed: ${(err as Error).message}`,
        lastChecked: Date.now(),
      });
    }
  }

  const allHealthy = checks.every(c => c.status === "ok");

  return { checks, allHealthy, timestamp: Date.now() };
}

/**
 * Print doctor results to console.
 */
export function printDoctorResult(result: DoctorResult): void {
  console.log(chalk.bold.cyan("\n🩺 Doctor / Healthcheck\n"));

  for (const check of result.checks) {
    const icon = check.status === "ok"
      ? chalk.green("✓")
      : check.status === "warn"
        ? chalk.yellow("⚠")
        : chalk.red("✗");
    const statusColor = check.status === "ok"
      ? chalk.green
      : check.status === "warn"
        ? chalk.yellow
        : chalk.red;

    console.log(`  ${icon} ${chalk.bold(check.name.padEnd(15))} ${statusColor(check.message)}`);
  }

  const summary = result.allHealthy
    ? chalk.green("\n  Tudo saudável ✓")
    : chalk.yellow(`\n  ${result.checks.filter((c: DoctorCheck) => c.status !== "ok").length} item(s) com atenção`);
  console.log(summary);
  console.log();
}
