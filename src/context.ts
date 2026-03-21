import { ModeManager } from "./agent/modes.js";
import { HonestyGuard } from "./agent/honesty-guard.js";
import { ApprovalMemory } from "./agent/approval-memory.js";
import { ActionLedger } from "./agent/action-ledger.js";
import { SessionMemory } from "./memory/session.js";
import { SkillDispatcher } from "./skills/dispatcher.js";
import { SkillLoader } from "./skills/loader.js";
import { SubagentRunner, SubagentExecutionConfig } from "./subagents/runner.js";

export interface AppContext {
    modeManager: ModeManager;
    honestyGuard: HonestyGuard;
    approvalMemory: ApprovalMemory;
    actionLedger: ActionLedger;
    session: SessionMemory;
    skillDispatcher: SkillDispatcher;
    subagentRunner: SubagentRunner;
}

export function createAppContext(): AppContext {
    const modeManager = new ModeManager();
    const honestyGuard = new HonestyGuard();
    const session = new SessionMemory(modeManager);

    // Wire skill dispatcher
    const skillLoader = new SkillLoader();
    const skillDispatcher = new SkillDispatcher(skillLoader);

    // Wire subagent runner with basic tool executor
    const subagentConfig: SubagentExecutionConfig = {
        toolExecutor: {
            readFile: async (p: string) => {
                const fs = await import("fs/promises");
                return fs.readFile(p, "utf-8");
            },
            listFiles: async (pattern: string) => {
                const { execSync } = await import("child_process");
                return execSync(`find . -path "${pattern}" -type f 2>/dev/null | head -50`, { encoding: "utf-8" })
                    .trim().split("\n").filter(Boolean);
            },
            grep: async (pattern: string, dir: string) => {
                const { execSync } = await import("child_process");
                try {
                    return execSync(`grep -rn "${pattern}" ${dir} 2>/dev/null | head -20`, { encoding: "utf-8" })
                        .trim().split("\n").filter(Boolean);
                } catch { return []; }
            },
            runCommand: async (cmd: string) => {
                const { execSync } = await import("child_process");
                try {
                    const stdout = execSync(cmd, { encoding: "utf-8", timeout: 30000 });
                    return { exitCode: 0, stdout, stderr: "" };
                } catch (err: any) {
                    return { exitCode: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
                }
            },
        },
    };
    const subagentRunner = new SubagentRunner(subagentConfig);

    return {
        modeManager,
        honestyGuard,
        approvalMemory: session.approvalMemory,
        actionLedger: new ActionLedger(),
        session,
        skillDispatcher,
        subagentRunner,
    };
}
