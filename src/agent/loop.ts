import { PythonBridge } from "../bridge/python-bridge.js";

import chalk from "chalk";
import ora from "ora";
import { z } from "zod";
import { AppContext } from "../context.js";
import { getHookEngine, HookEvent, HookAction } from "../hooks/engine.js";



export interface AgentRunResult {
    error?: string;
    status?: string;
    skill_used?: string;
    output?: unknown;
}

export interface AgentContext {
    task: string;
    maxSteps: number;
}

export class AgentLoop {
    constructor(private bridge: PythonBridge, private appContext: AppContext) {
    }

    async run(context: AgentContext): Promise<void> {
        const engine = getHookEngine();
        const hookResult = await engine.emit(HookEvent.ON_SESSION_START, {
            mode: this.appContext.modeManager.getMode(),
            task: context.task
        });

        if (hookResult.action === HookAction.BLOCK) {
            console.log(chalk.red(`\n⛔ Session blocked by hook: ${hookResult.reason}`));
            return;
        }

        const spinner = ora("Delegating task to Python Agent Engine...").start();

        try {
            const start = Date.now();
            const result = await this.bridge.call<AgentRunResult>("agent_run", {
                user_input: context.task,
                max_steps: context.maxSteps
            }, 300000); // 5 min timeout for deep agent runs

            const elapsed = Date.now() - start;

            if (result.error) {
                spinner.fail(`Agent Engine failed: ${result.error}`);
                return;
            }

            spinner.succeed(`Task complete [took ${elapsed}ms]`);

            // Post-hoc honesty validation: audit the agent's output claims
            const outputText = typeof result.output === "string"
                ? result.output
                : JSON.stringify(result.output ?? "");
            const validation = this.appContext.honestyGuard.validateForMode(
                outputText,
                this.appContext.modeManager.getMode()
            );
            if (!validation.valid) {
                console.log(chalk.yellow(`\n⚠ Honesty check: ${validation.violation}`));
            }

            if (result.status === "success") {
                if (result.skill_used) {
                    console.log(chalk.cyan(`\n[Skill Used: ${result.skill_used}]`));
                }

                // Format if it's an object or string
                if (typeof result.output === 'object') {
                    console.log("\n" + chalk.green(JSON.stringify(result.output, null, 2)));
                } else {
                    console.log("\n" + chalk.green(result.output));
                }
            } else {
                console.log("\n" + chalk.yellow(JSON.stringify(result, null, 2)));
            }
        } catch (err: any) {
            spinner.fail(`Error communicating with Agent Engine: ${err.message}`);
            console.error(err);
        }
    }
}
