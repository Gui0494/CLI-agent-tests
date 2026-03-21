import { isInteractive, isCI, noColor, isPiped } from "../../src/cli/detect-mode.js";

describe("detect-mode", () => {
  it("exports boolean flags", () => {
    expect(typeof isInteractive).toBe("boolean");
    expect(typeof isCI).toBe("boolean");
    expect(typeof noColor).toBe("boolean");
    expect(typeof isPiped).toBe("boolean");
  });

  it("isCI reflects CI env var", () => {
    // In test env, CI may or may not be set
    if (process.env.CI === "true" || process.env.CI === "1") {
      expect(isCI).toBe(true);
    }
    // At minimum, it should be a boolean
    expect(typeof isCI).toBe("boolean");
  });
});
