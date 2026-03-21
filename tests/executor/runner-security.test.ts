/**
 * Unit tests for executor security hardening:
 * - requireSandbox blocks local fallback for SHELL_UNSAFE
 * - SHELL_SAFE still allows local fallback with approval
 */

// Mock config loader before importing runner (avoids import.meta.url issue)
jest.mock("../../src/config/loader.js", () => ({
  config: {
    executor: {
      timeout_ms: 30000,
      max_retries: 1,
    },
  },
}));

// Mock docker-sandbox to simulate Docker unavailable
jest.mock("../../src/executor/docker-sandbox.js", () => ({
  runInSandbox: jest.fn().mockRejectedValue(new Error("Docker not available")),
}));

// Mock retry to not retry (simplifies tests)
jest.mock("../../src/executor/retry.js", () => ({
  withRetry: async (fn: () => Promise<unknown>) => fn(),
  isTransientError: () => false,
}));

import { createExecutor } from "../../src/executor/runner.js";

describe("Executor Security — requireSandbox", () => {
  it("blocks local fallback when requireSandbox=true", async () => {
    const executor = createExecutor({
      useSandbox: true,
      requireSandbox: true,
      onLocalFallbackRequest: async () => true, // would approve, but should never be called
    });

    await expect(executor.run("rm -rf /")).rejects.toThrow(
      "Docker sandbox is required"
    );
  });

  it("blocks execution when requireSandbox=true and useSandbox=false", async () => {
    const executor = createExecutor({
      useSandbox: false,
      requireSandbox: true,
    });

    await expect(executor.run("dangerous-command")).rejects.toThrow(
      "SHELL_UNSAFE commands require Docker sandbox"
    );
  });

  it("allows local fallback for SHELL_SAFE when approved", async () => {
    const approvalFn = jest.fn().mockResolvedValue(true);
    const executor = createExecutor({
      useSandbox: true,
      requireSandbox: false,
      onLocalFallbackRequest: approvalFn,
    });

    // Should fall back to local execution (echo is safe)
    const result = await executor.run("echo hello");
    expect(approvalFn).toHaveBeenCalled();
    expect(result.stdout).toContain("hello");
  });

  it("blocks local fallback for SHELL_SAFE when not approved", async () => {
    const approvalFn = jest.fn().mockResolvedValue(false);
    const executor = createExecutor({
      useSandbox: true,
      requireSandbox: false,
      onLocalFallbackRequest: approvalFn,
    });

    await expect(executor.run("echo hello")).rejects.toThrow(
      "local execution was not approved"
    );
  });

  it("error message mentions Docker when requireSandbox fails", async () => {
    const executor = createExecutor({
      useSandbox: true,
      requireSandbox: true,
    });

    try {
      await executor.run("npm test");
      fail("Should have thrown");
    } catch (err: any) {
      expect(err.message).toContain("Docker");
      expect(err.message).toContain("SHELL_UNSAFE");
      expect(err.message).toContain("Ensure Docker is installed");
    }
  });
});
