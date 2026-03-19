/**
 * preview.ts — Preview manager for AurexAI CLI Agent
 *
 * @deprecated Not yet connected to REPL. TODO: Wire PreviewManager into
 * /preview command.
 *
 * Detects project type, finds free port, spawns dev server,
 * waits for it to be ready, and manages lifecycle.
 *
 * @deprecated Not yet connected to REPL.
 * TODO: Wire PreviewManager into a /preview REPL command.
 * The manager is fully implemented and tested but no production code path uses it.
 *
 * Reference: docs/architecture-reference/prompts/preview.md
 */

import * as net from "net";
import * as http from "http";
import * as fs from "fs/promises";
import { ChildProcess, spawn } from "child_process";
import chalk from "chalk";

// ─── Interfaces ──────────────────────────────────────────

export interface ProjectType {
  framework: string;
  devCommand: string;
  buildCommand: string;
  defaultPort: number;
  hasDevServer: boolean;
}

export interface PreviewResult {
  success: boolean;
  url?: string;
  pid?: number;
  port?: number;
  httpReady?: boolean;
  error?: string;
}

interface DetectionRule {
  check: (pkg: any, files: string[]) => boolean;
  result: ProjectType;
}

// ─── Detection Rules ─────────────────────────────────────

const DETECTION_RULES: DetectionRule[] = [
  {
    check: (pkg) => !!(pkg.dependencies?.["next"] || pkg.devDependencies?.["next"]),
    result: {
      framework: "next",
      devCommand: "npx next dev --port {{PORT}}",
      buildCommand: "npx next build",
      defaultPort: 3000,
      hasDevServer: true,
    },
  },
  {
    check: (pkg) => !!pkg.devDependencies?.["vite"],
    result: {
      framework: "vite",
      devCommand: "npx vite --port {{PORT}}",
      buildCommand: "npx vite build",
      defaultPort: 5173,
      hasDevServer: true,
    },
  },
  {
    check: (pkg) => !!pkg.dependencies?.["react-scripts"],
    result: {
      framework: "cra",
      devCommand: "npx react-scripts start",
      buildCommand: "npx react-scripts build",
      defaultPort: 3000,
      hasDevServer: true,
    },
  },
  {
    check: (pkg) => !!pkg.dependencies?.["express"],
    result: {
      framework: "express",
      devCommand: "node .",
      buildCommand: "",
      defaultPort: 3000,
      hasDevServer: true,
    },
  },
  {
    check: (pkg) => !!pkg.dependencies?.["fastify"],
    result: {
      framework: "fastify",
      devCommand: "node .",
      buildCommand: "",
      defaultPort: 3000,
      hasDevServer: true,
    },
  },
  {
    check: (_pkg, files) => files.includes("index.html"),
    result: {
      framework: "static",
      devCommand: "npx serve . -l {{PORT}}",
      buildCommand: "",
      defaultPort: 3000,
      hasDevServer: false,
    },
  },
];

// ─── Python Detection ────────────────────────────────────

async function detectPythonFramework(): Promise<ProjectType | null> {
  try {
    const requirements = await fs.readFile("requirements.txt", "utf-8");
    if (requirements.includes("flask")) {
      return {
        framework: "flask",
        devCommand: "python -m flask run --port {{PORT}}",
        buildCommand: "",
        defaultPort: 5000,
        hasDevServer: true,
      };
    }
    if (requirements.includes("django")) {
      return {
        framework: "django",
        devCommand: "python manage.py runserver {{PORT}}",
        buildCommand: "",
        defaultPort: 8000,
        hasDevServer: true,
      };
    }
    if (requirements.includes("fastapi") || requirements.includes("uvicorn")) {
      return {
        framework: "fastapi",
        devCommand: "uvicorn main:app --port {{PORT}} --reload",
        buildCommand: "",
        defaultPort: 8000,
        hasDevServer: true,
      };
    }
    return {
      framework: "python",
      devCommand: "python -m http.server {{PORT}}",
      buildCommand: "",
      defaultPort: 8000,
      hasDevServer: false,
    };
  } catch {
    return null;
  }
}

// ─── Preview Manager ─────────────────────────────────────

export class PreviewManager {
  private activeProcess: ChildProcess | null = null;
  private activePort: number | null = null;

  /**
   * Detect the project type from workspace files.
   */
  async detectProject(): Promise<ProjectType | null> {
    let pkg: any = {};
    let files: string[] = [];

    try {
      const entries = await fs.readdir(".");
      files = entries;
    } catch {
      return null;
    }

    // Try package.json
    try {
      pkg = JSON.parse(await fs.readFile("package.json", "utf-8"));
    } catch {
      // No package.json — check for Python
      if (files.includes("requirements.txt") || files.includes("pyproject.toml")) {
        return detectPythonFramework();
      }
      // Check for static HTML
      if (files.includes("index.html")) {
        return DETECTION_RULES[DETECTION_RULES.length - 1].result;
      }
      return null;
    }

    // Match against Node.js detection rules
    for (const rule of DETECTION_RULES) {
      if (rule.check(pkg, files)) {
        return rule.result;
      }
    }

    // Fallback: if has a "dev" script, try it
    if (pkg.scripts?.dev) {
      return {
        framework: "custom",
        devCommand: "npm run dev -- --port {{PORT}}",
        buildCommand: pkg.scripts.build ? "npm run build" : "",
        defaultPort: 3000,
        hasDevServer: true,
      };
    }

    if (pkg.scripts?.start) {
      return {
        framework: "custom",
        devCommand: "npm start",
        buildCommand: "",
        defaultPort: 3000,
        hasDevServer: true,
      };
    }

    return null;
  }

  /**
   * Detect the package manager from lockfiles.
   */
  async detectPackageManager(): Promise<string> {
    const checks = [
      { file: "pnpm-lock.yaml", pm: "pnpm" },
      { file: "yarn.lock", pm: "yarn" },
      { file: "bun.lockb", pm: "bun" },
      { file: "package-lock.json", pm: "npm" },
    ];

    for (const { file, pm } of checks) {
      try {
        await fs.access(file);
        return pm;
      } catch { /* skip */ }
    }

    return "npm";
  }

  /**
   * Start preview server for the given project type.
   */
  async start(projectType: ProjectType): Promise<PreviewResult> {
    // 1. Find free port
    let port: number;
    try {
      port = await this.findFreePort(projectType.defaultPort);
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }

    // 2. Substitute port in command
    const command = projectType.devCommand.replace(/\{\{PORT\}\}/g, String(port));

    console.log(chalk.gray(`   Iniciando: ${command}`));
    console.log(chalk.gray(`   Porta: ${port}`));

    // 3. Spawn process
    const isWindows = process.platform === "win32";
    const shell = isWindows ? true : "/bin/sh";

    this.activeProcess = spawn(command, [], {
      shell,
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      detached: !isWindows,
      env: { ...process.env, PORT: String(port), BROWSER: "none" },
    });

    // Capture output
    let stdout = "";
    let stderr = "";
    this.activeProcess.stdout?.on("data", (d: Buffer) => stdout += d.toString());
    this.activeProcess.stderr?.on("data", (d: Buffer) => stderr += d.toString());

    // Handle early exit
    const earlyExit = new Promise<string>((resolve) => {
      this.activeProcess!.on("exit", (code) => {
        resolve(`Processo saiu com código ${code}\nstdout: ${stdout}\nstderr: ${stderr}`);
      });
    });

    // 4. Wait for port to be open (or early exit)
    const portReady = await Promise.race([
      this.waitForPort(port, 30_000),
      earlyExit.then(() => false as const),
    ]);

    if (typeof portReady === "string") {
      // Process exited early
      this.activeProcess = null;
      return { success: false, error: portReady };
    }

    if (!portReady) {
      this.stop();
      return {
        success: false,
        error: `Servidor não respondeu na porta ${port} após 30s.\nstdout: ${stdout}\nstderr: ${stderr}`,
      };
    }

    // 5. HTTP healthcheck
    const httpReady = await this.waitForHTTP(port, 15_000);

    if (!httpReady) {
      console.log(chalk.yellow(
        "   ⚠ Servidor aceitando conexões mas HTTP não responde ainda.\n" +
        "     O app pode estar compilando."
      ));
    }

    this.activePort = port;

    return {
      success: true,
      url: `http://localhost:${port}`,
      pid: this.activeProcess.pid,
      port,
      httpReady,
    };
  }

  /**
   * Stop the preview server.
   */
  stop(): void {
    if (this.activeProcess) {
      try {
        if (process.platform === "win32") {
          // Windows: use taskkill
          spawn("taskkill", ["/pid", String(this.activeProcess.pid), "/f", "/t"], {
            stdio: "ignore",
          });
        } else {
          // Unix: kill process group
          process.kill(-this.activeProcess.pid!, "SIGTERM");
          setTimeout(() => {
            try {
              if (this.activeProcess && !this.activeProcess.killed) {
                process.kill(-this.activeProcess.pid!, "SIGKILL");
              }
            } catch { /* already dead */ }
          }, 5000);
        }
      } catch { /* already dead */ }
      this.activeProcess = null;
      this.activePort = null;
    }
  }

  /**
   * Check if preview is running.
   */
  isRunning(): boolean {
    return this.activeProcess !== null && !this.activeProcess.killed;
  }

  /**
   * Get preview info.
   */
  getInfo(): { port: number; pid: number; url: string } | null {
    if (!this.isRunning() || !this.activePort || !this.activeProcess?.pid) return null;
    return {
      port: this.activePort,
      pid: this.activeProcess.pid,
      url: `http://localhost:${this.activePort}`,
    };
  }

  /**
   * Print preview panel to terminal.
   */
  static printResult(result: PreviewResult): void {
    if (!result.success) {
      console.log(chalk.red("\n   ✗ Preview falhou"));
      console.log(chalk.gray(`   ${result.error}`));
      return;
    }

    console.log(chalk.bold.cyan("\n   ┌────────────── PREVIEW ──────────────┐"));
    console.log(chalk.green("   │  ✓ Servidor rodando                 │"));
    console.log(`   │  URL:  ${chalk.cyan(result.url!).padEnd(36)}│`);
    console.log(`   │  PID:  ${chalk.gray(String(result.pid)).padEnd(28)}│`);
    console.log(`   │  HTTP: ${result.httpReady ? chalk.green("pronto") : chalk.yellow("compilando...")}${" ".repeat(result.httpReady ? 22 : 15)}│`);
    console.log(chalk.gray("   │  [s] Parar servidor                 │"));
    console.log(chalk.bold.cyan("   └──────────────────────────────────────┘\n"));
  }

  // ─── Private Methods ────────────────────────────────────

  private async findFreePort(startPort: number): Promise<number> {
    for (let port = startPort; port < startPort + 100; port++) {
      const free = await this.isPortFree(port);
      if (free) return port;
    }
    throw new Error(`Nenhuma porta livre entre ${startPort} e ${startPort + 99}`);
  }

  private isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close();
        resolve(true);
      });
      server.listen(port);
    });
  }

  private async waitForPort(port: number, timeout: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const connected = await this.tryConnect(port);
      if (connected) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  private async waitForHTTP(port: number, timeout: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const ok = await this.tryHTTP(port);
      if (ok) return true;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  }

  private tryConnect(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
      socket.connect(port, "localhost");
    });
  }

  private tryHTTP(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(`http://localhost:${port}/`, (res) => {
        resolve(res.statusCode !== undefined);
      });
      req.on("error", () => resolve(false));
      req.setTimeout(3000, () => {
        req.destroy();
        resolve(false);
      });
    });
  }
}

// ─── Cleanup on Exit ─────────────────────────────────────

const _previewInstances: PreviewManager[] = [];

export function registerPreviewCleanup(manager: PreviewManager): void {
  _previewInstances.push(manager);
}

function cleanupAll(): void {
  for (const m of _previewInstances) {
    m.stop();
  }
}

process.on("exit", cleanupAll);
process.on("SIGINT", () => { cleanupAll(); process.exit(0); });
process.on("SIGTERM", () => { cleanupAll(); process.exit(0); });
