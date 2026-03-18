import Dockerode from "dockerode";
import { config as appConfig } from "../config/loader.js";

const docker = new Dockerode();

export interface SandboxConfig {
  image: string;
  memoryLimit: string;
  cpuLimit: string;
  workDir: string;
  timeout: number;
}

const DEFAULT_CONFIG: SandboxConfig = {
  image: appConfig.executor.docker_image,
  memoryLimit: appConfig.executor.memory_limit,
  cpuLimit: appConfig.executor.cpu_limit,
  workDir: "/workspace",
  timeout: appConfig.executor.timeout_ms,
};

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
}

export async function runInSandbox(
  command: string,
  config: Partial<SandboxConfig> = {}
): Promise<SandboxResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();

  const container = await docker.createContainer({
    Image: cfg.image,
    Cmd: ["bash", "-c", command],
    WorkingDir: cfg.workDir,
    User: "1000:1000",
    HostConfig: {
      Memory: parseMemory(cfg.memoryLimit),
      NanoCpus: parseCpu(cfg.cpuLimit),
      NetworkMode: "none", // no network access in sandbox
      AutoRemove: true,
      ReadonlyRootfs: true,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges", "apparmor=docker-default"],
      Binds: [
        `${process.cwd()}:${cfg.workDir}:ro`,
        // Also need temporary directory writable for many tools
      ],
      Tmpfs: {
        "/tmp": "rw,noexec,nosuid,size=64m",
        "/output": "rw,size=128m",
      },
    },
    Tty: false,
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;

  try {
    await container.start();

    const stream = await container.logs({ follow: true, stdout: true, stderr: true });

    const logPromise = new Promise<void>((resolve) => {
      stream.on("data", (chunk: Buffer) => {
        let offset = 0;
        while (offset < chunk.length) {
          // Docker multiplexed stream: first 8 bytes are header
          // [8] bytes header: [0] stream type, [4-7] payload size
          const type = chunk[offset];
          if (offset + 8 > chunk.length) break; // incomplete header

          const length = chunk.readUInt32BE(offset + 4);
          if (offset + 8 + length > chunk.length) break; // incomplete payload

          const payload = chunk.subarray(offset + 8, offset + 8 + length).toString();
          if (type === 1) stdout += payload;
          else if (type === 2) stderr += payload;

          offset += 8 + length;
        }
      });
      stream.on("end", resolve);
    });

    let timeoutId: NodeJS.Timeout;
    const timeoutPromise = new Promise<void>((resolve) => {
      timeoutId = setTimeout(async () => {
        timedOut = true;
        try {
          await container.kill();
        } catch { /* empty */ }
        resolve();
      }, cfg.timeout);
    });

    await Promise.race([logPromise, timeoutPromise]);
    clearTimeout(timeoutId!);

    const info = await container.inspect().catch(() => null);
    const exitCode = info?.State?.ExitCode ?? (timedOut ? 124 : 1);

    return {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode,
      timedOut,
      durationMs: Date.now() - startTime,
    };
  } catch (err: any) {
    return {
      stdout,
      stderr: err.message || "Container execution failed",
      exitCode: 1,
      timedOut: false,
      durationMs: Date.now() - startTime,
    };
  }
}

function parseMemory(limit: string): number {
  const match = limit.match(/^(\d+)([mg])$/i);
  if (!match) return 512 * 1024 * 1024;
  const val = parseInt(match[1]);
  return match[2].toLowerCase() === "g" ? val * 1024 * 1024 * 1024 : val * 1024 * 1024;
}

function parseCpu(limit: string): number {
  return Math.floor(parseFloat(limit) * 1e9);
}
