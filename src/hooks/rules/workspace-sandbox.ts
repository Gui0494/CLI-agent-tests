/**
 * workspace-sandbox.ts — Pre-write hook rule
 *
 * Blocks file writes outside the workspace boundary.
 *
 * Reference: docs/architecture-reference/hooks/workspace-sandbox.md
 */

import { HookContext, HookResult, HookAction } from "../engine.js";
import { getWorkspaceSandbox } from "../../security/sandbox.js";

/**
 * Workspace sandbox hook handler.
 * Ensures file operations stay within the workspace root.
 */
export function workspaceSandboxHook(context: HookContext): HookResult {
  const filePath = context.filePath;

  if (!filePath) {
    return { action: HookAction.ALLOW };
  }

  const sandbox = getWorkspaceSandbox();
  const error = sandbox.validate(filePath as string);

  if (error) {
    return {
      action: HookAction.BLOCK,
      reason: error,
      suggestion: `Mova o arquivo para dentro do workspace: ${sandbox.getRoot()}`,
    };
  }

  return { action: HookAction.ALLOW };
}
