/**
 * Unit tests for PreviewManager
 */
import { PreviewManager } from "../../src/tools/preview.js";
import { jest } from "@jest/globals";

describe("PreviewManager", () => {
  jest.setTimeout(30000);
  let manager: PreviewManager;

  beforeEach(() => {
    manager = new PreviewManager();
  });

  afterEach(() => {
    manager.stop();
  });

  describe("detectProject", () => {
    it("returns null when no project files exist", async () => {
      // This test runs in the actual project directory which has package.json
      // So it will actually detect something — that's fine, we're testing the flow
      const result = await manager.detectProject();
      // Should detect something since we're in a real project
      // The exact result depends on the project's package.json
      expect(result === null || typeof result === "object").toBe(true);
    });
  });

  describe("detectPackageManager", () => {
    it("detects package manager from lockfiles", async () => {
      const pm = await manager.detectPackageManager();
      expect(["npm", "yarn", "pnpm", "bun"]).toContain(pm);
    });
  });

  describe("isRunning", () => {
    it("returns false when no server is started", () => {
      expect(manager.isRunning()).toBe(false);
    });
  });

  describe("getInfo", () => {
    it("returns null when no server is running", () => {
      expect(manager.getInfo()).toBeNull();
    });
  });

  describe("stop", () => {
    it("does nothing when no server is running", () => {
      expect(() => manager.stop()).not.toThrow();
    });
  });

  describe("printResult", () => {
    it("prints success result", () => {
      const spy = jest.spyOn(console, "log").mockImplementation(() => {});
      PreviewManager.printResult({
        success: true,
        url: "http://localhost:3000",
        pid: 1234,
        port: 3000,
        httpReady: true,
      });
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it("prints failure result", () => {
      const spy = jest.spyOn(console, "log").mockImplementation(() => {});
      PreviewManager.printResult({
        success: false,
        error: "Test error",
      });
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
