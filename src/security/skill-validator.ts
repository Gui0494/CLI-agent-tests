/**
 * skill-validator.ts — Static analysis validator for LLM-generated skill code.
 *
 * Scans generated Python skill code for dangerous patterns before it is
 * written to disk. This is a defense-in-depth measure — the Docker sandbox
 * is the primary security boundary.
 *
 * @security-note This is a best-effort static check, not a sandbox.
 */

// ─── Interfaces ──────────────────────────────────────────

export interface SkillValidationResult {
  valid: boolean;
  violations: SkillViolation[];
}

export interface SkillViolation {
  pattern: string;
  line: number;
  snippet: string;
  severity: "critical" | "warning";
}

// ─── Deny Patterns ──────────────────────────────────────

interface DenyPattern {
  pattern: RegExp;
  description: string;
  severity: "critical" | "warning";
}

const DENY_PATTERNS: DenyPattern[] = [
  // Shell execution
  { pattern: /\bos\.system\s*\(/, description: "os.system() — shell execution", severity: "critical" },
  { pattern: /\bsubprocess\b/, description: "subprocess module — shell execution", severity: "critical" },
  { pattern: /\bos\.popen\s*\(/, description: "os.popen() — shell execution", severity: "critical" },
  { pattern: /\bos\.exec\w*\s*\(/, description: "os.exec*() — process replacement", severity: "critical" },

  // Code injection
  { pattern: /\b__import__\s*\(/, description: "__import__() — dynamic import", severity: "critical" },
  { pattern: /\beval\s*\(/, description: "eval() — code execution", severity: "critical" },
  { pattern: /\bexec\s*\(/, description: "exec() — code execution", severity: "critical" },
  { pattern: /\bcompile\s*\(/, description: "compile() — code compilation", severity: "critical" },

  // Filesystem destruction
  { pattern: /\bshutil\.rmtree\s*\(/, description: "shutil.rmtree() — recursive deletion", severity: "critical" },
  { pattern: /\bos\.remove\s*\(/, description: "os.remove() — file deletion", severity: "warning" },
  { pattern: /\bos\.unlink\s*\(/, description: "os.unlink() — file deletion", severity: "warning" },
  { pattern: /\bos\.rmdir\s*\(/, description: "os.rmdir() — directory removal", severity: "warning" },

  // Sensitive file access
  { pattern: /open\s*\(\s*["']\/etc/, description: "Reading system files (/etc)", severity: "critical" },
  { pattern: /open\s*\(\s*["']\/proc/, description: "Reading proc filesystem", severity: "critical" },
  { pattern: /open\s*\(\s*["']~\/\.ssh/, description: "Accessing SSH keys", severity: "critical" },

  // Network (could exfiltrate data)
  { pattern: /\bsocket\b/, description: "socket module — raw network access", severity: "warning" },
  { pattern: /\brequests\b/, description: "requests module — HTTP client", severity: "warning" },
  { pattern: /\burllib\b/, description: "urllib module — HTTP client", severity: "warning" },

  // Privilege escalation
  { pattern: /\bos\.setuid\s*\(/, description: "os.setuid() — privilege change", severity: "critical" },
  { pattern: /\bos\.setgid\s*\(/, description: "os.setgid() — privilege change", severity: "critical" },
  { pattern: /\bctypes\b/, description: "ctypes — native code execution", severity: "critical" },
];

// ─── Allowed Imports ────────────────────────────────────

const SAFE_MODULES = new Set([
  "os.path", "pathlib", "json", "yaml", "re", "typing",
  "datetime", "collections", "dataclasses", "enum", "abc",
  "logging", "math", "textwrap", "string", "io", "copy",
  "functools", "itertools", "operator", "contextlib",
]);

// ─── Validator ──────────────────────────────────────────

/**
 * Validate Python skill code for dangerous patterns.
 */
export function validateSkillCode(code: string): SkillValidationResult {
  const violations: SkillViolation[] = [];
  const lines = code.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comments
    const trimmed = line.trimStart();
    if (trimmed.startsWith("#")) continue;

    for (const deny of DENY_PATTERNS) {
      deny.pattern.lastIndex = 0;
      if (deny.pattern.test(line)) {
        violations.push({
          pattern: deny.description,
          line: i + 1,
          snippet: line.trim().slice(0, 120),
          severity: deny.severity,
        });
      }
    }
  }

  return {
    valid: violations.filter(v => v.severity === "critical").length === 0,
    violations,
  };
}

/**
 * Check if skill code defines the expected run() entry point.
 */
export function hasRunEntryPoint(code: string): boolean {
  return /^(?:async\s+)?def\s+run\s*\(/m.test(code);
}
