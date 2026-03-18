/**
 * post-edit.ts — Post-edit hook rule
 *
 * Runs formatter/lint automatically after file edits.
 *
 * Reference: docs/architecture-reference/hooks/post-edit.md
 */

import { HookContext, HookResult, HookAction } from "../engine.js";
import * as path from "path";

// File extensions that have known formatters
const FORMATTABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.json',
  '.css', '.scss', '.less',
  '.html', '.vue', '.svelte',
  '.py',
  '.md',
]);

/**
 * Post-edit hook handler.
 * Signals that formatting/linting should run after file edits.
 */
export function postEditHook(context: HookContext): HookResult {
  const filePath = context.filePath;

  if (!filePath) {
    return { action: HookAction.ALLOW };
  }

  const ext = path.extname(filePath as string).toLowerCase();

  if (FORMATTABLE_EXTENSIONS.has(ext)) {
    return {
      action: HookAction.RUN,
      reason: `Formatter/lint should run on ${path.basename(filePath as string)} (${ext})`,
      suggestion: `Consider running prettier/eslint on the edited file.`,
    };
  }

  return { action: HookAction.ALLOW };
}
