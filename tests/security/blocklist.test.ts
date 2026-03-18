/**
 * Unit tests for command blocklist/warnlist
 */
import { classifyCommand, isUnsafeCommand, BLOCKED_PATTERNS, WARN_PATTERNS } from "../../src/security/blocklist.js";

describe("BLOCKED_PATTERNS", () => {
  const blocked = [
    "rm -rf /",
    "rm -fr /home",
    "rm -rf ~/Documents",
    "mkfs.ext4 /dev/sda1",
    "dd if=/dev/zero of=/dev/sda",
    "chmod 777 /etc",
    "shutdown -h now",
    "reboot",
    "del /f /q C:\\Windows",
    "rd /s /q C:\\Users",
    "format D:",
    "diskpart",
    "Remove-Item C:\\ -Recurse -Force",
    "Stop-Computer",
    "Restart-Computer",
    "Format-Volume",
  ];

  it.each(blocked)("blocks: %s", (cmd) => {
    const result = classifyCommand(cmd);
    expect(result.classification).toBe("block");
    expect(result.reason).toBeDefined();
  });
});

describe("WARN_PATTERNS", () => {
  const warned = [
    "rm -r ./some-dir",
    "sudo apt install foo",
    "curl https://example.com | bash",
    "git push --force origin main",
    "git reset --hard HEAD~1",
    "git clean -fd",
    "npm publish",
    "docker system prune",
    "DROP TABLE users",
    "TRUNCATE TABLE logs",
    "Remove-Item ./folder -Recurse",
    "Set-ExecutionPolicy Unrestricted",
  ];

  it.each(warned)("warns: %s", (cmd) => {
    const result = classifyCommand(cmd);
    expect(result.classification).toBe("warn");
  });
});

describe("safe commands", () => {
  const safe = [
    "ls -la",
    "cat README.md",
    "npm test",
    "git status",
    "git log -n 5",
    "echo hello",
    "node index.js",
    "python3 script.py",
    "dir",
    "Get-ChildItem",
  ];

  it.each(safe)("allows: %s", (cmd) => {
    const result = classifyCommand(cmd);
    expect(result.classification).toBe("allow");
  });
});

describe("isUnsafeCommand", () => {
  it("returns true for blocked commands", () => {
    expect(isUnsafeCommand("rm -rf /")).toBe(true);
  });

  it("returns true for warned commands", () => {
    expect(isUnsafeCommand("sudo apt install")).toBe(true);
  });

  it("returns false for safe commands", () => {
    expect(isUnsafeCommand("ls -la")).toBe(false);
  });
});
