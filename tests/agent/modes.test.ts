/**
 * Unit tests for ModeManager and mode system
 */
import { ModeManager, Mode, VALID_TRANSITIONS, MODE_CONFIGS, MODE_EMOJI } from "../../src/agent/modes.js";

describe("Mode enum", () => {
  it("should have 5 modes", () => {
    expect(Object.values(Mode)).toHaveLength(5);
    expect(Object.values(Mode)).toEqual(["CHAT", "PLAN", "ACT", "AUTO", "RESEARCH"]);
  });
});

describe("VALID_TRANSITIONS", () => {
  it("CHAT can go to PLAN, ACT, RESEARCH, AUTO", () => {
    expect(VALID_TRANSITIONS[Mode.CHAT]).toContain(Mode.PLAN);
    expect(VALID_TRANSITIONS[Mode.CHAT]).toContain(Mode.ACT);
    expect(VALID_TRANSITIONS[Mode.CHAT]).toContain(Mode.RESEARCH);
    expect(VALID_TRANSITIONS[Mode.CHAT]).toContain(Mode.AUTO);
  });

  it("AUTO can only go to CHAT or PLAN", () => {
    expect(VALID_TRANSITIONS[Mode.AUTO]).toEqual([Mode.CHAT, Mode.PLAN]);
  });

  it("every mode has at least one valid transition", () => {
    for (const mode of Object.values(Mode)) {
      expect(VALID_TRANSITIONS[mode].length).toBeGreaterThan(0);
    }
  });
});

describe("MODE_CONFIGS", () => {
  it("every mode has a config", () => {
    for (const mode of Object.values(Mode)) {
      expect(MODE_CONFIGS[mode]).toBeDefined();
      expect(MODE_CONFIGS[mode].allowedTools).toBeDefined();
      expect(MODE_CONFIGS[mode].blockedTools).toBeDefined();
      expect(MODE_CONFIGS[mode].systemPromptAddition).toBeDefined();
    }
  });

  it("CHAT blocks shell and write", () => {
    expect(MODE_CONFIGS[Mode.CHAT].blockedTools).toContain("shell");
    expect(MODE_CONFIGS[Mode.CHAT].blockedTools).toContain("fs_write");
  });

  it("ACT allows wildcard", () => {
    expect(MODE_CONFIGS[Mode.ACT].allowedTools).toContain("*");
  });
});

describe("ModeManager", () => {
  let mm: ModeManager;

  beforeEach(() => {
    mm = new ModeManager();
  });

  it("starts in CHAT mode", () => {
    expect(mm.getMode()).toBe(Mode.CHAT);
  });

  it("has emoji for current mode", () => {
    expect(mm.getEmoji()).toBe(MODE_EMOJI[Mode.CHAT]);
  });

  it("can switch to a valid mode", async () => {
    await mm.switch(Mode.PLAN);
    expect(mm.getMode()).toBe(Mode.PLAN);
  });

  it("no-ops when switching to the same mode", async () => {
    await mm.switch(Mode.CHAT);
    expect(mm.getMode()).toBe(Mode.CHAT);
    expect(mm.getHistory()).toHaveLength(0);
  });

  it("records history on switch", async () => {
    await mm.switch(Mode.PLAN);
    mm.setApprovedPlan(true);
    await mm.switch(Mode.ACT);
    expect(mm.getHistory()).toEqual([Mode.CHAT, Mode.PLAN]);
  });

  it("throws on invalid transition", async () => {
    // AUTO → RESEARCH is not allowed
    mm.setConfirmFunction(async () => true);
    await mm.switch(Mode.AUTO);
    await expect(mm.switch(Mode.RESEARCH)).rejects.toThrow("não permitida");
  });

  it("emits modeChange event", async () => {
    const fn = jest.fn();
    mm.on("modeChange", fn);
    await mm.switch(Mode.PLAN);
    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({ from: Mode.CHAT, to: Mode.PLAN })
    );
  });

  it("PLAN→ACT requires approved plan", async () => {
    await mm.switch(Mode.PLAN);
    await expect(mm.switch(Mode.ACT)).rejects.toThrow("plano aprovado");
  });

  it("PLAN→ACT works with approved plan", async () => {
    await mm.switch(Mode.PLAN);
    mm.setApprovedPlan(true);
    await mm.switch(Mode.ACT);
    expect(mm.getMode()).toBe(Mode.ACT);
  });

  it("*→AUTO requires confirmation", async () => {
    // Without confirmFn
    await expect(mm.switch(Mode.AUTO)).rejects.toThrow("função de confirmação");
  });

  it("*→AUTO denied if user says no", async () => {
    mm.setConfirmFunction(async () => false);
    await mm.switch(Mode.AUTO);
    expect(mm.getMode()).toBe(Mode.CHAT); // stayed in CHAT
  });

  it("*→AUTO accepted if user says yes", async () => {
    mm.setConfirmFunction(async () => true);
    await mm.switch(Mode.AUTO);
    expect(mm.getMode()).toBe(Mode.AUTO);
  });

  describe("isToolAllowed", () => {
    it("allows read tools in CHAT", () => {
      expect(mm.isToolAllowed("fs_read")).toBe(true);
    });

    it("blocks shell in CHAT", () => {
      expect(mm.isToolAllowed("shell")).toBe(false);
    });

    it("allows everything in ACT", async () => {
      await mm.switch(Mode.ACT);
      expect(mm.isToolAllowed("shell")).toBe(true);
      expect(mm.isToolAllowed("fs_write")).toBe(true);
    });
  });
});
