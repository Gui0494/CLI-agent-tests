import { PythonBridge } from "../bridge/python-bridge.js";
import { ToolRegistry } from "./tools.js";
import chalk from "chalk";
import ora from "ora";
import { z } from "zod";

const AgentResponseSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("tool_call"),
        id: z.string().optional(),
        tool: z.string(),
        args: z.record(z.unknown()),
    }),
    z.object({
        type: z.literal("final"),
        content: z.string(),
    }),
]);

export interface AgentContext {
    task: string;
    maxSteps: number;
}

export class AgentLoop {
    private registry: ToolRegistry;

    constructor(private bridge: PythonBridge) {
        this.registry = new ToolRegistry(bridge);
    }

    async run(context: AgentContext): Promise<void> {
        const spinner = ora("Delegating task to Python Agent Engine...").start();

        try {
            const start = Date.now();
            const result = await this.bridge.call("agent_run", {
                user_input: context.task,
                max_steps: context.maxSteps
            }, 300000); // 5 min timeout for deep agent runs

            const elapsed = Date.now() - start;

            if (result.error) {
                spinner.fail(`Agent Engine failed: ${result.error}`);
                return;
            }

            spinner.succeed(`Task complete [took ${elapsed}ms]`);

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
