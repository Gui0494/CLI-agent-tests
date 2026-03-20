/**
 * Unit tests for permission system
 */
import { Mode } from "../../src/agent/modes.js";
import {
  PermissionClass,
  MODE_PERMISSION_MATRIX,
  TOOL_PERMISSION_MAP,
  checkPermission,
  isAllowed,
  isDenied,
  requiresApproval,
  getToolPermissionClass,
} from "../../src/security/permissions.js";

describe("MODE_PERMISSION_MATRIX", () => {
  it("CHAT allows only READ", () => {
    const chatPerms = MODE_PERMISSION_MATRIX[Mode.CHAT];
    expect(chatPerms[PermissionClass.READ]).toBe("allow");
    expect(chatPerms[PermissionClass.WRITE_LOCAL]).toBe("deny");
    expect(chatPerms[PermissionClass.SHELL_SAFE]).toBe("deny");
    expect(chatPerms[PermissionClass.DEPLOY]).toBe("deny");
  });

  it("ACT asks for most write actions", () => {
    const actPerms = MODE_PERMISSION_MATRIX[Mode.ACT];
    expect(actPerms[PermissionClass.WRITE_LOCAL]).toBe("ask");
    expect(actPerms[PermissionClass.SHELL_SAFE]).toBe("ask");
    expect(actPerms[PermissionClass.GIT_LOCAL]).toBe("ask");
  });

  it("AUTO allows write-local but denies deploy/publish/db-write", () => {
    const autoPerms = MODE_PERMISSION_MATRIX[Mode.AUTO];
    expect(autoPerms[PermissionClass.WRITE_LOCAL]).toBe("allow");
    expect(autoPerms[PermissionClass.SHELL_SAFE]).toBe("allow");
    expect(autoPerms[PermissionClass.DEPLOY]).toBe("deny");
    expect(autoPerms[PermissionClass.PUBLISH]).toBe("deny");
    expect(autoPerms[PermissionClass.DB_WRITE]).toBe("deny");
  });

  it("AUTO always asks for shell-unsafe and git-remote", () => {
    const autoPerms = MODE_PERMISSION_MATRIX[Mode.AUTO];
    expect(autoPerms[PermissionClass.SHELL_UNSAFE]).toBe("ask");
    expect(autoPerms[PermissionClass.GIT_REMOTE]).toBe("ask");
  });

  it("every mode covers all 12 permission classes", () => {
    const allClasses = Object.values(PermissionClass);
    for (const mode of Object.values(Mode)) {
      for (const pc of allClasses) {
        expect(MODE_PERMISSION_MATRIX[mode][pc]).toBeDefined();
      }
    }
  });
});

describe("TOOL_PERMISSION_MAP", () => {
  it("maps fs_read to READ", () => {
    expect(TOOL_PERMISSION_MAP["fs_read"]).toBe(PermissionClass.READ);
  });

  it("maps git_push to GIT_REMOTE", () => {
    expect(TOOL_PERMISSION_MAP["git_push"]).toBe(PermissionClass.GIT_REMOTE);
  });

  it("maps deploy to DEPLOY", () => {
    expect(TOOL_PERMISSION_MAP["deploy"]).toBe(PermissionClass.DEPLOY);
  });
});

describe("checkPermission", () => {
  it("returns allow for READ in CHAT", () => {
    expect(checkPermission(Mode.CHAT, "fs_read")).toBe("allow");
  });

  it("returns deny for shell in CHAT", () => {
    expect(checkPermission(Mode.CHAT, "exec_command")).toBe("deny");
  });

  it("returns ask for write in ACT", () => {
    expect(checkPermission(Mode.ACT, "write_file")).toBe("ask");
  });
});

describe("convenience functions", () => {
  it("isAllowed", () => {
    expect(isAllowed(Mode.CHAT, "fs_read")).toBe(true);
    expect(isAllowed(Mode.CHAT, "shell")).toBe(false);
  });

  it("isDenied", () => {
    expect(isDenied(Mode.CHAT, "deploy")).toBe(true);
    expect(isDenied(Mode.ACT, "fs_read")).toBe(false);
  });

  it("requiresApproval", () => {
    expect(requiresApproval(Mode.ACT, "write_file")).toBe(true);
    expect(requiresApproval(Mode.CHAT, "fs_read")).toBe(false);
  });
});

describe("getToolPermissionClass", () => {
  it("returns known permission class", () => {
    expect(getToolPermissionClass("git_push")).toBe(PermissionClass.GIT_REMOTE);
  });

  it("defaults to SHELL_UNSAFE for unknown tools (conservative policy)", () => {
    expect(getToolPermissionClass("unknown_tool")).toBe(PermissionClass.SHELL_UNSAFE);
  });
});
