/**
 * sandbox.ts — Workspace sandbox for AurexAI CLI Agent
 *
 * Ensures file operations stay within the workspace boundary.
 *
 * Reference: docs/architecture-reference/hooks/workspace-sandbox.md
 */

import * as path from "path";
import * as fs from "fs";

// ─── Workspace Sandbox ──────────────────────────────────

export class WorkspaceSandbox {
  private workspaceRoot: string;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = path.resolve(workspaceRoot ?? process.cwd());
  }

  /**
   * Get the workspace root path.
   */
  getRoot(): string {
    return this.workspaceRoot;
  }

  /**
   * Check if a file path is inside the workspace.
   * Resolves the path and checks if it starts with the workspace root.
   */
  isInsideWorkspace(filePath: string): boolean {
    // Reject Windows-style absolute paths when running on non-Windows
    if (process.platform !== 'win32' && /^[A-Za-z]:[/\\]/.test(filePath)) {
      return false;
    }

    let resolved = path.resolve(filePath);
    try {
      resolved = fs.realpathSync(resolved);
    } catch {
      // If the file doesn't exist yet, it's safe to check the unresolved path
    }
    const normalizedRoot = this.normalizePath(this.workspaceRoot);
    const normalizedPath = this.normalizePath(resolved);

    // Check that the resolved path is within workspace root
    return normalizedPath.startsWith(normalizedRoot + path.sep) ||
           normalizedPath === normalizedRoot;
  }

  /**
   * Validate a file path. Returns an error message if outside workspace, null if OK.
   */
  validate(filePath: string): string | null {
    if (!this.isInsideWorkspace(filePath)) {
      const resolved = path.resolve(filePath);
      return (
        `Access blocked: "${resolved}" is outside the workspace.\n` +
        `Workspace: "${this.workspaceRoot}"\n` +
        `The agent can only access files within the workspace.`
      );
    }
    return null;
  }

  /**
   * Get the relative path from workspace root.
   */
  relativePath(filePath: string): string {
    return path.relative(this.workspaceRoot, path.resolve(filePath));
  }

  /**
   * Normalize path for consistent comparisons (lowercase on Windows).
   */
  private normalizePath(p: string): string {
    const normalized = path.normalize(p);
    // On Windows, normalize case for comparison
    if (process.platform === 'win32') {
      return normalized.toLowerCase();
    }
    return normalized;
  }
}

// ─── Singleton for the current workspace ─────────────────

let defaultSandbox: WorkspaceSandbox | null = null;

export function getWorkspaceSandbox(root?: string): WorkspaceSandbox {
  if (!defaultSandbox || root) {
    defaultSandbox = new WorkspaceSandbox(root);
  }
  return defaultSandbox;
}
