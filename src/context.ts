import { ModeManager } from "./agent/modes.js";
import { HonestyGuard } from "./agent/honesty-guard.js";
import { ApprovalMemory } from "./agent/approval-memory.js";
import { ActionLedger } from "./agent/action-ledger.js";

export interface AppContext {
    modeManager: ModeManager;
    honestyGuard: HonestyGuard;
    approvalMemory: ApprovalMemory;
    actionLedger: ActionLedger;
}

export function createAppContext(): AppContext {
    const modeManager = new ModeManager();
    const honestyGuard = new HonestyGuard();
    return {
        modeManager,
        honestyGuard,
        approvalMemory: new ApprovalMemory(),
        actionLedger: new ActionLedger()
    };
}
