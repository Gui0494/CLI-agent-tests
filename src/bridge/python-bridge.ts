import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { createRequest, parseResponse, validateMethodParams, JsonRpcResponse } from "./protocol.js";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface BridgeRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params: Record<string, unknown>;
}

// Minimal EventEmitter type shim (no @types/node in this project)
declare class NodeEventEmitter {
  on(event: string | symbol, listener: (...args: unknown[]) => void): this;
  emit(event: string | symbol, ...args: unknown[]): boolean;
  off(event: string | symbol, listener: (...args: unknown[]) => void): this;
}
const TypedEventEmitter = EventEmitter as unknown as { new(): NodeEventEmitter };

// ─── Rate Limiter ──────────────────────────────────────

export interface BridgeRateLimitConfig {
  maxCallsPerSecond: number;
  maxCallsPerMinute: number;
}

const DEFAULT_RATE_LIMIT: BridgeRateLimitConfig = {
  maxCallsPerSecond: 10,
  maxCallsPerMinute: 120,
};

// Methods exempt from rate limiting (handshake + streaming notifications)
const RATE_LIMIT_EXEMPT = new Set(["ready", "stream_chunk"]);

export class PythonBridge extends TypedEventEmitter {
  private static activeInstances = new Set<PythonBridge>();
  private static globalSigintHandler: (() => void) | null = null;

  private process: ChildProcess | null = null;
  private requestId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = "";

  // Rate limiting state
  private callTimestamps: number[] = [];
  private rateLimitConfig: BridgeRateLimitConfig;

  constructor(rateLimitConfig?: Partial<BridgeRateLimitConfig>) {
    super();
    this.rateLimitConfig = { ...DEFAULT_RATE_LIMIT, ...rateLimitConfig };
  }

  isStarted(): boolean {
    return this.process !== null;
  }

  /**
   * Wait if rate limits are exceeded. Sliding window approach.
   * Delays instead of rejecting to avoid breaking the agent loop.
   */
  private async enforceRateLimit(method: string): Promise<void> {
    if (RATE_LIMIT_EXEMPT.has(method)) return;

    const now = Date.now();

    // Prune timestamps older than 60s
    this.callTimestamps = this.callTimestamps.filter(t => now - t < 60000);

    // Check per-second burst limit (last 1000ms)
    const recentSecond = this.callTimestamps.filter(t => now - t < 1000);
    if (recentSecond.length >= this.rateLimitConfig.maxCallsPerSecond) {
      const waitMs = 1000 - (now - recentSecond[0]);
      if (waitMs > 0) {
        console.error(`[python-bridge] Rate limited: ${recentSecond.length} calls in last 1s, waiting ${waitMs}ms`);
        await new Promise(r => setTimeout(r, waitMs));
      }
    }

    // Check per-minute limit
    if (this.callTimestamps.length >= this.rateLimitConfig.maxCallsPerMinute) {
      const waitMs = 60000 - (now - this.callTimestamps[0]);
      if (waitMs > 0) {
        console.error(`[python-bridge] Rate limited: ${this.callTimestamps.length} calls in last 60s, waiting ${waitMs}ms`);
        await new Promise(r => setTimeout(r, Math.min(waitMs, 5000)));
      }
    }

    this.callTimestamps.push(Date.now());
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
      PythonBridge.unregisterInstance(this);
    });

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

    PythonBridge.registerInstance(this);
  }

  private static registerInstance(instance: PythonBridge): void {
    PythonBridge.activeInstances.add(instance);
    if (!PythonBridge.globalSigintHandler) {
      PythonBridge.globalSigintHandler = () => {
        for (const inst of PythonBridge.activeInstances) {
          inst.abortAll(new Error("User interrupted operation"));
          inst.stop();
        }
      };
      process.on("SIGINT", PythonBridge.globalSigintHandler);
    }
  }

  private static unregisterInstance(instance: PythonBridge): void {
    PythonBridge.activeInstances.delete(instance);
    if (PythonBridge.activeInstances.size === 0 && PythonBridge.globalSigintHandler) {
      process.off("SIGINT", PythonBridge.globalSigintHandler);
      PythonBridge.globalSigintHandler = null;
    }
  }

  private abortAll(error: Error) {
    for (const [, handler] of this.pending) {
      handler.reject(error);
    }
    this.pending.clear();
  }

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 60000): Promise<T> {
    if (!this.process) throw new Error("Python bridge not started");

    await this.enforceRateLimit(method);

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
          resolve(value as T);
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

  /**
   * Call a Python method that streams token-by-token via JSON-RPC notifications.
   * Listens for "stream_chunk" notifications and calls onChunk for each.
   */
  async callStream(
    method: string,
    params: Record<string, unknown>,
    opts: { onChunk: (token: string) => void; signal?: AbortSignal },
  ): Promise<void> {
    if (!this.process) throw new Error("Python bridge not started");

    const id = ++this.requestId;
    const request = createRequest(method, params, id);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Stream '${method}' timed out after 120s`));
      }, 120000);

      const onAbort = () => {
        cleanup();
        resolve();
      };

      if (opts.signal) {
        opts.signal.addEventListener("abort", onAbort, { once: true });
      }

      // Listen for notification events (emitted by processBuffer for id-less messages)
      const onNotification = (...args: unknown[]) => {
        const notification = args[0] as { method: string; params: Record<string, unknown> };
        if (notification.method === "stream_chunk" && (notification.params as any)?.request_id === id) {
          const token = (notification.params as any)?.token;
          if (token) opts.onChunk(token);
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.off("notification", onNotification);
        this.pending.delete(id);
        if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
      };

      // Listen for final response (stream complete)
      this.pending.set(id, {
        resolve: () => { cleanup(); resolve(); },
        reject: (err) => { cleanup(); reject(err); },
      });

      this.on("notification", onNotification);

      this.process!.stdin!.write(request, (err) => {
        if (!err) return;
        cleanup();
        reject(err);
      });
    });
  }

  stop(): void {
    PythonBridge.unregisterInstance(this);
    if (this.process) {
      const p = this.process;
      this.process = null;
      try { p.kill("SIGTERM"); } catch (e) { /* ignore */ }
      setTimeout(() => {
        try { p.kill("SIGKILL"); } catch (e) { /* ignore */ }
      }, 2000).unref();
    }
  }

  /**
   * Send a JSON-RPC response back to the Python process.
   * Used when Python sends a request (e.g., run_node_tool, permission_request).
   */
  sendResponse(id: number, result?: unknown, error?: { code: number; message: string }): void {
    if (!this.process?.stdin) return;
    const payload = error
      ? { jsonrpc: "2.0", id, error }
      : { jsonrpc: "2.0", id, result: result ?? null };
    this.process.stdin.write(JSON.stringify(payload) + "\n");
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        // Skip ready signals (already handled during init)
        if (trimmed === '{"ready": true}') continue;

        const parsed = JSON.parse(trimmed);

        // Detect incoming requests/notifications from Python (has method field)
        if (parsed.method && typeof parsed.method === "string") {
          // JSON-RPC notifications (no id) — emit as notification event
          if (parsed.id == null) {
            this.emit("notification", { method: parsed.method, params: parsed.params ?? {} });
            continue;
          }

          // Validate incoming request params against schema
          try {
            const validatedParams = validateMethodParams(parsed.method, parsed.params ?? {});
            const validated: BridgeRequest = {
              jsonrpc: parsed.jsonrpc ?? "2.0",
              id: parsed.id,
              method: parsed.method,
              params: validatedParams,
            };
            this.emit("request", validated);
          } catch (validationError: any) {
            console.error(`[python-bridge] Request validation failed for method "${parsed.method}": ${validationError.message}`);
            // Send error response back to Python
            if (parsed.id != null) {
              this.sendResponse(parsed.id, undefined, {
                code: -32602,
                message: `Invalid params: ${validationError.message}`,
              });
            }
          }
          continue;
        }

        // Otherwise treat as response to our call
        const response = parseResponse(trimmed);
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

