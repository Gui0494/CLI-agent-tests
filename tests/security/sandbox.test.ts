/**
 * Unit tests for WorkspaceSandbox
 */
import * as path from "path";
import { WorkspaceSandbox } from "../../src/security/sandbox.js";

describe("WorkspaceSandbox", () => {
  const root = process.cwd();
  let sandbox: WorkspaceSandbox;

  beforeEach(() => {
    sandbox = new WorkspaceSandbox(root);
  });

  it("getRoot returns the workspace root", () => {
    expect(sandbox.getRoot()).toBe(path.resolve(root));
  });

  it("allows files inside the workspace", () => {
    expect(sandbox.isInsideWorkspace(path.join(root, "src", "index.ts"))).toBe(true);
    expect(sandbox.isInsideWorkspace(path.join(root, "package.json"))).toBe(true);
  });

  it("allows the workspace root itself", () => {
    expect(sandbox.isInsideWorkspace(root)).toBe(true);
  });

  it("blocks files outside the workspace", () => {
    expect(sandbox.isInsideWorkspace("/etc/passwd")).toBe(false);
    expect(sandbox.isInsideWorkspace("C:\\Windows\\System32")).toBe(false);
  });

  it("blocks path traversal", () => {
    expect(sandbox.isInsideWorkspace(path.join(root, "..", "..", "etc", "passwd"))).toBe(false);
  });

  it("validate returns null for valid paths", () => {
    expect(sandbox.validate(path.join(root, "src", "foo.ts"))).toBeNull();
  });

  it("validate returns error string for invalid paths", () => {
    const result = sandbox.validate("/etc/passwd");
    expect(result).not.toBeNull();
    expect(result).toContain("fora do workspace");
  });

  it("relativePath works correctly", () => {
    const rel = sandbox.relativePath(path.join(root, "src", "index.ts"));
    expect(rel).toBe(path.join("src", "index.ts"));
  });
});
