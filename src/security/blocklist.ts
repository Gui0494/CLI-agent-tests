/**
 * blocklist.ts — Command blocklist/warnlist for AurexAI CLI Agent
 *
 * > [!WARNING]
 * > DANGER: REGEX BLOCKLISTS ARE INHERENTLY INSECURE AND BYPASSABLE
 * >
 * > This blocklist relies on regular expressions to catch dangerous commands.
 * > It is trivially bypassable using shell tricks (e.g. `r"m" -rf /`, `echo cnm\ | tr n r | sh`).
 * > DO NOT rely on this module as a primary security boundary.
 * > This is exclusively a defense-in-depth mechanism to prevent accidental 
 * > dangerous executions by the agent. Real security MUST be enforced by the
 * > Docker sandbox and user permission approvals.
 *
 * Cross-platform patterns for blocking destructive commands
 * and warning about potentially dangerous ones.
 *
 * Reference: docs/architecture-reference/hooks/pre-shell.md
 */

// ─── Blocked Patterns (DENY — never execute) ────────────

export const BLOCKED_PATTERNS: RegExp[] = [
  // ── Unix/Linux/macOS ──
  // Destructive deletion
  /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?-[a-zA-Z]*r[a-zA-Z]*\s+\//,   // rm -rf /
  /rm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?-[a-zA-Z]*f[a-zA-Z]*\s+\//,   // rm -fr /
  /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?-[a-zA-Z]*r[a-zA-Z]*\s+~/,    // rm -rf ~

  // Disk formatting
  /mkfs\./,
  /dd\s+if=.*of=\/dev/,

  // Fork bomb
  /:\(\)\s*\{\s*:\|:&\s*\}\s*;:/,
  /\.\(\)\s*\{\s*\.\|\.&\s*\}\s*;\./,

  // Dangerous permissions
  /chmod\s+(-[a-zA-Z]*\s+)?777\s+\//,
  /chown\s+(-[a-zA-Z]*\s+)?root\s+\//,

  // Device writes
  />\s*\/dev\/sd[a-z]/,
  />\s*\/dev\/nvme/,

  // Network destruction
  /iptables\s+-F/,
  /ufw\s+disable/,

  // Shutdown/reboot
  /shutdown/,
  /reboot/,
  /init\s+[06]/,

  // ── Windows (CMD) ──
  /del\s+\/[fF]\s+\/[qQ]/,
  /rd\s+\/[sS]\s+\/[qQ]/,
  /format\s+[a-zA-Z]:/i,
  /diskpart/i,

  // ── Windows (PowerShell) ──
  /Remove-Item\s+.*-Recurse\s+.*-Force/i,
  /Remove-Item\s+.*-Force\s+.*-Recurse/i,
  /Clear-Disk/i,
  /Stop-Computer/i,
  /Restart-Computer/i,
  /Format-Volume/i,
];

// ─── Warn Patterns (ASK — request confirmation) ─────────

export const WARN_PATTERNS: RegExp[] = [
  // ── Unix/Linux/macOS ──
  /rm\s+-[a-zA-Z]*r/,          // rm recursive (any, not just /)
  /sudo\s+/,                   // any command with sudo
  /curl.*\|\s*(ba)?sh/,        // curl pipe to bash

  // ── Git (cross-platform) ──
  /git\s+push\s+.*--force/,    // force push
  /git\s+reset\s+--hard/,      // reset hard
  /git\s+clean\s+-[a-zA-Z]*f/, // git clean force

  // ── Package managers (cross-platform) ──
  /npm\s+publish/,             // publish package
  /npx\s+/,                    // execute remote package

  // ── Docker (cross-platform) ──
  /docker\s+system\s+prune/,   // clean docker

  // ── SQL (cross-platform) ──
  /drop\s+table/i,
  /drop\s+database/i,
  /truncate\s+table/i,

  // ── Windows (PowerShell) ──
  /Remove-Item\s+.*-Recurse/i,
  /Set-ExecutionPolicy/i,
];

// ─── Classification ─────────────────────────────────────

/**
 * @security-note Classification levels:
 * - 'allow': safe to execute
 * - 'warn_destructive': matches a destructive pattern — display a prominent
 *   warning and require explicit user confirmation. This is a UX guardrail
 *   only; real security comes from the Docker sandbox + permission approvals.
 * - 'warn': potentially dangerous — request confirmation
 */
export type CommandClassification = 'allow' | 'warn_destructive' | 'warn';

export interface ClassificationResult {
  classification: CommandClassification;
  reason?: string;
  suggestion?: string;
  matchedPattern?: string;
}

/**
 * Classify a shell command as 'allow', 'warn_destructive', or 'warn'.
 *
 * @security-note This regex-based classification is trivially bypassable
 * and must NOT be used as a security boundary. It exists solely as a
 * defense-in-depth UX warning to catch accidental destructive commands.
 * Real security is enforced by the Docker sandbox and user permission system.
 */
export function classifyCommand(command: string): ClassificationResult {
  // Check destructive patterns first (most severe warning)
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return {
        classification: 'warn_destructive',
        reason: `Destructive command detected: "${command}" matches a dangerous pattern.`,
        suggestion: 'This command may cause irreversible damage. Requires explicit user confirmation.',
        matchedPattern: pattern.source,
      };
    }
  }

  // Check warn list
  for (const pattern of WARN_PATTERNS) {
    if (pattern.test(command)) {
      return {
        classification: 'warn',
        reason: `Potentially dangerous command: "${command}".`,
        suggestion: 'Confirm before executing.',
        matchedPattern: pattern.source,
      };
    }
  }

  return { classification: 'allow' };
}

/**
 * Check if a command should be reclassified as shell-unsafe
 * (for tools that default to shell-safe).
 */
export function isUnsafeCommand(command: string): boolean {
  const result = classifyCommand(command);
  return result.classification === 'warn_destructive' || result.classification === 'warn';
}
