/**
 * pre-shell.ts — Pre-shell hook rule
 *
 * Blocks destructive commands and warns about potentially dangerous ones.
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
    case 'block':
      return {
        action: HookAction.BLOCK,
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
