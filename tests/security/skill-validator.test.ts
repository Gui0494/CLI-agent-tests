/**
 * Unit tests for skill-validator (Finding 6 — sandbox validation for create_agent)
 */
import { validateSkillCode, hasRunEntryPoint } from "../../src/security/skill-validator.js";

describe("validateSkillCode", () => {
  describe("critical violations", () => {
    it("rejects os.system()", () => {
      const result = validateSkillCode(`
import os
def run(args):
    os.system("rm -rf /")
`);
      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.severity === "critical")).toBe(true);
    });

    it("rejects subprocess", () => {
      const result = validateSkillCode(`
import subprocess
def run(args):
    subprocess.run(["ls"])
`);
      expect(result.valid).toBe(false);
    });

    it("rejects eval()", () => {
      const result = validateSkillCode(`
def run(args):
    result = eval(args["code"])
`);
      expect(result.valid).toBe(false);
    });

    it("rejects exec()", () => {
      const result = validateSkillCode(`
def run(args):
    exec("print('hello')")
`);
      expect(result.valid).toBe(false);
    });

    it("rejects __import__()", () => {
      const result = validateSkillCode(`
def run(args):
    mod = __import__("os")
`);
      expect(result.valid).toBe(false);
    });

    it("rejects shutil.rmtree()", () => {
      const result = validateSkillCode(`
import shutil
def run(args):
    shutil.rmtree("/tmp/data")
`);
      expect(result.valid).toBe(false);
    });

    it("rejects reading /etc files", () => {
      const result = validateSkillCode(`
def run(args):
    f = open("/etc/passwd")
`);
      expect(result.valid).toBe(false);
    });

    it("rejects ctypes", () => {
      const result = validateSkillCode(`
import ctypes
def run(args):
    ctypes.CDLL("libc.so.6")
`);
      expect(result.valid).toBe(false);
    });
  });

  describe("warnings (non-critical)", () => {
    it("warns on os.remove but still valid", () => {
      const result = validateSkillCode(`
import os
def run(args):
    os.remove("temp.txt")
`);
      expect(result.valid).toBe(true);
      expect(result.violations.some(v => v.severity === "warning")).toBe(true);
    });

    it("warns on requests import but still valid", () => {
      const result = validateSkillCode(`
import requests
def run(args):
    return requests.get("https://api.example.com").json()
`);
      expect(result.valid).toBe(true);
      expect(result.violations.length).toBeGreaterThan(0);
    });
  });

  describe("safe code", () => {
    it("allows safe skill code", () => {
      const result = validateSkillCode(`
import json
import os.path

def run(args):
    data = json.loads(args["input"])
    return {"result": data}
`);
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("ignores comments", () => {
      const result = validateSkillCode(`
# This uses os.system() for documentation purposes
def run(args):
    return {"ok": True}
`);
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe("multiple violations", () => {
    it("reports all violations", () => {
      const result = validateSkillCode(`
import subprocess
import os
def run(args):
    os.system("echo hi")
    eval(args["x"])
`);
      expect(result.valid).toBe(false);
      expect(result.violations.length).toBeGreaterThanOrEqual(3);
    });
  });
});

describe("hasRunEntryPoint", () => {
  it("detects def run()", () => {
    expect(hasRunEntryPoint("def run(args):\n    pass")).toBe(true);
  });

  it("detects async def run()", () => {
    expect(hasRunEntryPoint("async def run(args, ctx):\n    pass")).toBe(true);
  });

  it("returns false without run()", () => {
    expect(hasRunEntryPoint("def main(args):\n    pass")).toBe(false);
  });
});
