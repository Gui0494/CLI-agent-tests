import { spawn, ChildProcess } from "child_process";
import { createRequest, parseResponse, JsonRpcResponse } from "./protocol.js";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class PythonBridge {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private buffer = "";

  isStarted(): boolean {
    return this.process !== null;
  }

  async start(): Promise<void> {
    if (this.process) return;

    const pythonDir = path.resolve(__dirname, "../../python");
    const pythonCmd = os.platform() === "win32" ? "python" : "python3";

    this.process = spawn(pythonCmd, ["-m", "aurex.main"], {
      cwd: pythonDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.process.stderr!.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.error(`[python-stderr] ${msg}`);
    });

    this.process.on("exit", (code) => {
      this.abortAll(new Error(`Python process exited with code ${code}`));
      this.process = null;
      process.off("SIGINT", this.handleSigint);
    });

    process.off("SIGINT", this.handleSigint);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => cleanup(new Error("Python bridge timeout")), 10000);

      const cleanup = (err?: Error) => {
        clearTimeout(timeout);
        this.process?.stdout?.off("data", onReadyData);
        this.process?.off("error", onError);
        if (err) reject(err);
      };

      const onError = (err: Error) => cleanup(err);

      const onReadyData = (data: Buffer) => {
        this.buffer += data.toString("utf8");

        let newlineIdx = this.buffer.indexOf("\n");
        while (newlineIdx !== -1) {
          const line = this.buffer.slice(0, newlineIdx).trim();
          this.buffer = this.buffer.slice(newlineIdx + 1);

          if (!line) {
            newlineIdx = this.buffer.indexOf("\n");
            continue;
          }

          try {
            const parsed = JSON.parse(line);
            if (parsed?.ready === true) {
              clearTimeout(timeout);
              this.process!.stdout!.off("data", onReadyData);
              this.process!.stdout!.on("data", (d: Buffer) => {
                this.buffer += d.toString("utf8");
                this.processBuffer();
              });
              this.process!.off("error", onError);
              resolve();
              return;
            }

            console.error(`[python-stdout-preinit] ${line}`);
          } catch {
            console.error(`[python-stdout-preinit] ${line}`);
          }

          newlineIdx = this.buffer.indexOf("\n");
        }
      };

      this.process!.on("error", onError);
      this.process!.stdout!.on("data", onReadyData);
    });

    process.on("SIGINT", this.handleSigint);
  }

  private handleSigint = () => {
    this.abortAll(new Error("User interrupted operation"));
    this.stop();
  }

  private abortAll(error: Error) {
    for (const [, handler] of this.pending) {
      handler.reject(error);
    }
    this.pending.clear();
  }

  async call<T = any>(method: string, params: Record<string, unknown> = {}, timeoutMs = 60000): Promise<T> {
    if (!this.process) throw new Error("Python bridge not started");

    const id = ++this.requestId;
    const request = createRequest(method, params, id);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Python bridge request '${method}' timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      this.process!.stdin!.write(request, (err) => {
        if (!err) return;
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(err);
      });
    });
  }

  stop(): void {
    process.off("SIGINT", this.handleSigint);
    if (this.process) {
      const p = this.process;
      this.process = null;
      try { p.kill("SIGTERM"); } catch (e) { /* ignore */ }
      setTimeout(() => {
        try { p.kill("SIGKILL"); } catch (e) { /* ignore */ }
      }, 2000).unref();
    }
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const jsonStr = trimmed;
        // Strip out '{"ready": true}' or similar before standard parsing since they have been handled
        if (jsonStr === '{"ready": true}') continue;
        
        const response = parseResponse(jsonStr);
        const handler = this.pending.get(response.id);
        if (handler) {
          this.pending.delete(response.id);
          if (response.error) {
            handler.reject(new Error(response.error.message));
          } else {
            handler.resolve(response.result);
          }
        }
      } catch (e) {
        // Not JSON, probably a print() statement from Python
        console.error(`[python-stdout] ${trimmed}`);
      }
    }
  }
}

