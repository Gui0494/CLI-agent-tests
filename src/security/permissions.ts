/**
 * permissions.ts — Permission system for AurexAI CLI Agent
 *
 * Defines permission classes, permission levels, the mode×permission matrix,
 * and tool-to-permission mapping.
 *
 * Reference: docs/architecture-reference/specs/contracts.md §5, §6
 */

import { Mode } from "../agent/modes.js";

// ─── Permission Classes ──────────────────────────────────

export enum PermissionClass {
  READ          = 'read',
  WRITE_LOCAL   = 'write-local',
  SHELL_SAFE    = 'shell-safe',
  SHELL_UNSAFE  = 'shell-unsafe',
  GIT_LOCAL     = 'git-local',
  GIT_REMOTE    = 'git-remote',
  NETWORK       = 'network',
  INSTALL       = 'install',
  PREVIEW       = 'preview',
  DEPLOY        = 'deploy',
  PUBLISH       = 'publish',
  DB_WRITE      = 'db-write',
}

// ─── Permission Levels ───────────────────────────────────

export type PermissionLevel = 'allow' | 'ask' | 'deny';

// ─── Mode × Permission Matrix ────────────────────────────

export const MODE_PERMISSION_MATRIX: Record<Mode, Record<PermissionClass, PermissionLevel>> = {
  [Mode.CHAT]: {
    [PermissionClass.READ]:         'allow',
    [PermissionClass.WRITE_LOCAL]:  'deny',
    [PermissionClass.SHELL_SAFE]:   'deny',
    [PermissionClass.SHELL_UNSAFE]: 'deny',
    [PermissionClass.GIT_LOCAL]:    'deny',
    [PermissionClass.GIT_REMOTE]:   'deny',
    [PermissionClass.NETWORK]:      'deny',
    [PermissionClass.INSTALL]:      'deny',
    [PermissionClass.PREVIEW]:      'deny',
    [PermissionClass.DEPLOY]:       'deny',
    [PermissionClass.PUBLISH]:      'deny',
    [PermissionClass.DB_WRITE]:     'deny',
  },

  [Mode.PLAN]: {
    [PermissionClass.READ]:         'allow',
    [PermissionClass.WRITE_LOCAL]:  'deny',
    [PermissionClass.SHELL_SAFE]:   'deny',
    [PermissionClass.SHELL_UNSAFE]: 'deny',
    [PermissionClass.GIT_LOCAL]:    'deny',
    [PermissionClass.GIT_REMOTE]:   'deny',
    [PermissionClass.NETWORK]:      'allow',   // pode pesquisar para planejar
    [PermissionClass.INSTALL]:      'deny',
    [PermissionClass.PREVIEW]:      'deny',
    [PermissionClass.DEPLOY]:       'deny',
    [PermissionClass.PUBLISH]:      'deny',
    [PermissionClass.DB_WRITE]:     'deny',
  },

  [Mode.ACT]: {
    [PermissionClass.READ]:         'allow',
    [PermissionClass.WRITE_LOCAL]:  'ask',
    [PermissionClass.SHELL_SAFE]:   'ask',
    [PermissionClass.SHELL_UNSAFE]: 'ask',
    [PermissionClass.GIT_LOCAL]:    'ask',
    [PermissionClass.GIT_REMOTE]:   'ask',
    [PermissionClass.NETWORK]:      'allow',
    [PermissionClass.INSTALL]:      'ask',
    [PermissionClass.PREVIEW]:      'ask',
    [PermissionClass.DEPLOY]:       'ask',
    [PermissionClass.PUBLISH]:      'ask',
    [PermissionClass.DB_WRITE]:     'ask',
  },

  [Mode.AUTO]: {
    [PermissionClass.READ]:         'allow',
    [PermissionClass.WRITE_LOCAL]:  'allow',   // liberado após aprovação inicial
    [PermissionClass.SHELL_SAFE]:   'allow',   // liberado
    [PermissionClass.SHELL_UNSAFE]: 'ask',     // SEMPRE pede, mesmo em AUTO
    [PermissionClass.GIT_LOCAL]:    'allow',   // liberado
    [PermissionClass.GIT_REMOTE]:   'ask',     // push sempre pede
    [PermissionClass.NETWORK]:      'allow',   // liberado
    [PermissionClass.INSTALL]:      'ask',     // instalar deps sempre pede
    [PermissionClass.PREVIEW]:      'allow',   // liberado
    [PermissionClass.DEPLOY]:       'deny',    // NUNCA em AUTO
    [PermissionClass.PUBLISH]:      'deny',    // NUNCA em AUTO
    [PermissionClass.DB_WRITE]:     'deny',    // NUNCA em AUTO
  },

  [Mode.RESEARCH]: {
    [PermissionClass.READ]:         'allow',
    [PermissionClass.WRITE_LOCAL]:  'deny',
    [PermissionClass.SHELL_SAFE]:   'deny',
    [PermissionClass.SHELL_UNSAFE]: 'deny',
    [PermissionClass.GIT_LOCAL]:    'deny',
    [PermissionClass.GIT_REMOTE]:   'deny',
    [PermissionClass.NETWORK]:      'allow',
    [PermissionClass.INSTALL]:      'deny',
    [PermissionClass.PREVIEW]:      'deny',
    [PermissionClass.DEPLOY]:       'deny',
    [PermissionClass.PUBLISH]:      'deny',
    [PermissionClass.DB_WRITE]:     'deny',
  },
};

// ─── Tool → Permission Class ────────────────────────────

export const TOOL_PERMISSION_MAP: Record<string, PermissionClass> = {
  'fs_read':      PermissionClass.READ,
  'fs_glob':      PermissionClass.READ,
  'fs_grep':      PermissionClass.READ,
  'fs_write':     PermissionClass.WRITE_LOCAL,
  'fs_create':    PermissionClass.WRITE_LOCAL,
  'read_file':    PermissionClass.READ,
  'write_file':   PermissionClass.WRITE_LOCAL,
  'exec_command': PermissionClass.SHELL_SAFE,    // default; reclassified by blocklist
  'shell':        PermissionClass.SHELL_SAFE,    // default; reclassified by blocklist
  'git_add':      PermissionClass.GIT_LOCAL,
  'git_commit':   PermissionClass.GIT_LOCAL,
  'git_branch':   PermissionClass.GIT_LOCAL,
  'git_log':      PermissionClass.READ,
  'git_diff':     PermissionClass.READ,
  'git_push':     PermissionClass.GIT_REMOTE,
  'git_pull':     PermissionClass.GIT_REMOTE,
  'web_search':   PermissionClass.NETWORK,
  'web_fetch':    PermissionClass.NETWORK,
  'search':       PermissionClass.NETWORK,
  'fetch_url':    PermissionClass.NETWORK,
  'preview':      PermissionClass.PREVIEW,
  'npm_install':  PermissionClass.INSTALL,
  'deploy':       PermissionClass.DEPLOY,
  'npm_publish':  PermissionClass.PUBLISH,
};

// ─── Permission Checker ─────────────────────────────────

/**
 * Get the permission class for a tool.
 * Returns SHELL_UNSAFE as a conservative default for unknown tools.
 */
export function getToolPermissionClass(toolName: string): PermissionClass {
  return TOOL_PERMISSION_MAP[toolName] ?? PermissionClass.SHELL_UNSAFE;
}

/**
 * Check the permission level for a tool in a given mode.
 */
export function checkPermission(mode: Mode, toolName: string): PermissionLevel {
  const permClass = getToolPermissionClass(toolName);
  return MODE_PERMISSION_MATRIX[mode][permClass];
}

/**
 * Check if a tool is allowed (without needing approval) in a given mode.
 */
export function isAllowed(mode: Mode, toolName: string): boolean {
  return checkPermission(mode, toolName) === 'allow';
}

/**
 * Check if a tool is denied (cannot be used at all) in a given mode.
 */
export function isDenied(mode: Mode, toolName: string): boolean {
  return checkPermission(mode, toolName) === 'deny';
}

/**
 * Check if a tool requires approval in a given mode.
 */
export function requiresApproval(mode: Mode, toolName: string): boolean {
  return checkPermission(mode, toolName) === 'ask';
}
