import * as readline from "readline";
import chalk from "chalk";
import { PythonBridge, BridgeRequest } from "../bridge/python-bridge.js";
import { createExecutor, ExecutorConfig } from "../executor/runner.js";
import { AppContext } from "../context.js";
import {
    handleExec,
    handleReadFile,
    handleListFiles,
    handleEditFile,
    handleWriteFile,
    handleGrep,
    handleCreateAgent
} from "./tool-handlers.js";

export function setupBridgeHandlers(
  bridgeArg: PythonBridge,
  appContext: AppContext,
  rl?: readline.Interface,
  executorOptions?: ExecutorConfig
) {
    const bridge = bridgeArg;

    const ask = (q: string): Promise<string> => {
        return new Promise((resolve) => {
            if (process.env.AUREX_AUTO_YES === "1") {
                console.log(q + "y (auto)");
                return resolve("y");
            }
            if (rl) {
                rl.question(q, (ans) => {
                    setTimeout(() => resolve(ans), 0);
                });
            } else {
                const tempRl = readline.createInterface({ input: process.stdin, output: process.stdout });
                tempRl.question(q, (ans) => {
                    tempRl.close();
                    setTimeout(() => resolve(ans), 0);
                });
            }
        });
    };

    const executor = createExecutor({
        ...executorOptions,
        onLocalFallbackRequest: async (cmd: string) => {
            bridge.emit("pause_spinner");
            console.log(`\n${chalk.yellow(`⚠ SANDBOX FALHOU: O container Docker não está disponível.`)}`);
            const answer = await ask(`  Permitir execução local do comando na sua máquina? (${cmd}) [y/N]: `);
            bridge.emit("resume_spinner");
            return ["y", "yes", "s", "sim"].includes(answer.trim().toLowerCase());
        }
    });

    bridge.on("request", async (...args: unknown[]) => {
        const req = args[0] as BridgeRequest;
        if (req.method === "permission_request") {
            bridge.emit("pause_spinner");
            const { action, risk_level, reason } = req.params as { action: string; risk_level: string; reason: string };
            const color = risk_level === "critical" ? chalk.red : (risk_level === "high" ? chalk.redBright : chalk.yellow);

            console.log(`\n${color(`⚠ CONFIRMAÇÃO NECESSÁRIA [${risk_level.toUpperCase()}]`)}`);
            console.log(`  Ação: ${action}`);
            console.log(`  Risco: ${reason}`);

            const answer = await ask(`  Permitir? [y/N]: `);
            const allowed = ["y", "yes", "s", "sim"].includes(answer.trim().toLowerCase());
            bridge.sendResponse(req.id, { allowed });
            bridge.emit("resume_spinner");
        } else if (req.method === "run_node_tool") {
            const { tool_name, tool_args: raw_args } = req.params as { tool_name: string; tool_args: Record<string, unknown> };
            const tool_args = raw_args as any; // Args are validated by Python before dispatch
            bridge.emit("pause_spinner");
            try {
                if (!appContext.modeManager.isToolAllowed(tool_name)) {
                    throw new Error(`Tool ${tool_name} is blocked in current mode (${appContext.modeManager.getMode()})`);
                }

                let result;
                switch (tool_name) {
                    case "exec_command":
                        result = await handleExec(tool_args, executor, appContext);
                        break;
                    case "read_file":
                        result = await handleReadFile(tool_args);
                        break;
                    case "list_files":
                        result = await handleListFiles(tool_args);
                        break;
                    case "edit_file":
                        result = await handleEditFile(tool_args, ask, appContext);
                        break;
                    case "write_file":
                        result = await handleWriteFile(tool_args, ask, appContext);
                        break;
                    case "grep":
                        result = await handleGrep(tool_args);
                        break;
                    case "create_agent":
                        result = await handleCreateAgent(tool_args, ask);
                        break;
                    default:
                        throw new Error(`Unknown node tool: ${tool_name}`);
                }

                if (result.ok) {
                    appContext.honestyGuard.onToolExecuted({
                        id: req.id.toString(),
                        name: tool_name,
                        args: tool_args,
                        timestamp: Date.now()
                    });
                }

                bridge.sendResponse(req.id, result);
            } catch (err: unknown) {
                bridge.sendResponse(req.id, null, { code: -32000, message: (err as Error).message });
            } finally {
                bridge.emit("resume_spinner");
            }
        }
    });
}
