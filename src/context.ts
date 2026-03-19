import { ModeManager } from "./agent/modes.js";
import { HonestyGuard } from "./agent/honesty-guard.js";
import { ApprovalMemory } from "./agent/approval-memory.js";
import { ActionLedger } from "./agent/action-ledger.js";
import { SessionMemory } from "./memory/session.js";

export interface AppContext {
    modeManager: ModeManager;
    honestyGuard: HonestyGuard;
    approvalMemory: ApprovalMemory;
    actionLedger: ActionLedger;
    session: SessionMemory;
}

export function createAppContext(): AppContext {
    const modeManager = new ModeManager();
    const honestyGuard = new HonestyGuard();
    const session = new SessionMemory(modeManager);
    return {
        modeManager,
        honestyGuard,
        approvalMemory: session.approvalMemory,
        actionLedger: new ActionLedger(),
        session,
    };
}
