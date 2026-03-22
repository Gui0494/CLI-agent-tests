/**
 * pre-shell.ts — Pre-shell hook rule
 *
 * Warns about destructive and potentially dangerous commands.
 * Both 'warn_destructive' and 'warn' classifications require user confirmation.
 *
 * @security-note The blocklist is a UX guardrail only. Real security
 * is enforced by the Docker sandbox and user permission approvals.
 *
 * Reference: docs/architecture-reference/hooks/pre-shell.md
 */

import { HookContext, HookResult, HookAction } from "../engine.js";
import { classifyCommand } from "../../security/blocklist.js";

/**
 * Pre-shell hook handler.
 * Checks command against blocklist/warnlist before execution.
 */
export function preShellHook(context: HookContext): HookResult {
  const command = context.command;

  if (!command) {
    return { action: HookAction.ALLOW };
  }

  const classification = classifyCommand(command);

  switch (classification.classification) {
    case 'warn_destructive':
      // Previously 'block' — now requires explicit user confirmation instead
      // of silently refusing, since regex blocklists are trivially bypassable
      return {
        action: HookAction.WARN,
        reason: classification.reason,
        suggestion: classification.suggestion,
      };

    case 'warn':
      return {
        action: HookAction.WARN,
        reason: classification.reason,
        suggestion: classification.suggestion,
      };

    default:
      return { action: HookAction.ALLOW };
  }
}
