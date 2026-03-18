/**
 * Unit tests for HonestyGuard (anti-hallucination)
 */
import { HonestyGuard } from "../../src/agent/honesty-guard.js";
import { Mode } from "../../src/agent/modes.js";

describe("HonestyGuard", () => {
  let guard: HonestyGuard;

  beforeEach(() => {
    guard = new HonestyGuard();
  });

  describe("validateForMode — CHAT", () => {
    it("rejects side-effect claims in CHAT mode", () => {
      const result = guard.validateForMode("I created the file successfully", Mode.CHAT);
      expect(result.valid).toBe(false);
      expect(result.violation).toContain("side-effects");
    });

    it("allows normal text in CHAT mode", () => {
      const result = guard.validateForMode("Here is how you could approach this problem", Mode.CHAT);
      expect(result.valid).toBe(true);
    });
  });

  describe("validateForMode — PLAN", () => {
    it("rejects execution claims in PLAN mode", () => {
      const result = guard.validateForMode("I executed the migration script", Mode.PLAN);
      expect(result.valid).toBe(false);
      expect(result.violation).toContain("PLAN");
    });

    it("allows planning language in PLAN mode", () => {
      const result = guard.validateForMode("Step 1: We should create a new module for handling auth", Mode.PLAN);
      expect(result.valid).toBe(true);
    });
  });

  describe("validateForMode — ACT", () => {
    it("rejects action claims without tool calls", () => {
      const result = guard.validateForMode("I executed the build command successfully", Mode.ACT);
      expect(result.valid).toBe(false);
    });

    it("accepts action claims with tool calls registered", () => {
      guard.onToolExecuted({
        id: "tc-1",
        name: "exec_command",
        args: { cmd: "npm run build" },
        timestamp: Date.now(),
      });
      const result = guard.validateForMode("I executed the build command successfully", Mode.ACT);
      expect(result.valid).toBe(true);
    });
  });

  describe("validateForMode — RESEARCH", () => {
    it("rejects side-effect claims in RESEARCH", () => {
      const result = guard.validateForMode("I deleted the old config", Mode.RESEARCH);
      expect(result.valid).toBe(false);
    });
  });

  describe("clear", () => {
    it("resets tool call count", () => {
      guard.onToolExecuted({ id: "tc-1", name: "test", args: {}, timestamp: Date.now() });
      expect(guard.getToolCallCount()).toBe(1);
      guard.clear();
      expect(guard.getToolCallCount()).toBe(0);
    });
  });

  describe("extractActionClaims", () => {
    it("detects Portuguese claims", () => {
      const claims = guard.extractActionClaims("Eu criei o arquivo index.ts");
      expect(claims.length).toBeGreaterThan(0);
    });

    it("detects English claims", () => {
      const claims = guard.extractActionClaims("I removed the old configuration");
      expect(claims.length).toBeGreaterThan(0);
    });

    it("returns empty for neutral text", () => {
      const claims = guard.extractActionClaims("The function accepts two parameters");
      expect(claims).toHaveLength(0);
    });
  });
});
