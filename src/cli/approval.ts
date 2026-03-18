/**
 * approval.ts — Standardized approval flow for AurexAI CLI Agent
 *
 * Visual approval panels with risk indicators, scope selection,
 * and integration with permission classes and modes.
 *
 * Reference: docs/architecture-reference/prompts/approval-flow.md
 * Reference: docs/architecture-reference/specs/contracts.md §10
 */

import * as readline from "readline";
import chalk from "chalk";
import { PermissionClass } from "../security/permissions.js";
import { ApprovalMemory, ApprovalScope } from "../agent/approval-memory.js";

// ─── Risk Levels ─────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface RiskIndicator {
  bar: string;
  color: string;
  label: string;
}

export const RISK_INDICATORS: Record<RiskLevel, RiskIndicator> = {
  low:      { bar: '■□□□', color: 'green',   label: 'baixo' },
  medium:   { bar: '■■□□', color: 'yellow',  label: 'médio' },
  high:     { bar: '■■■□', color: 'red',     label: 'alto' },
  critical: { bar: '■■■■', color: 'bgRed',   label: 'CRÍTICO' },
};

// ─── Permission → Risk Mapping ───────────────────────────

export const PERMISSION_RISK_MAP: Record<PermissionClass, RiskLevel> = {
  [PermissionClass.READ]:         'low',
  [PermissionClass.WRITE_LOCAL]:  'low',
  [PermissionClass.SHELL_SAFE]:   'low',
  [PermissionClass.SHELL_UNSAFE]: 'high',
  [PermissionClass.GIT_LOCAL]:    'low',
  [PermissionClass.GIT_REMOTE]:   'medium',
  [PermissionClass.NETWORK]:      'low',
  [PermissionClass.INSTALL]:      'medium',
  [PermissionClass.PREVIEW]:      'low',
  [PermissionClass.DEPLOY]:       'critical',
  [PermissionClass.PUBLISH]:      'critical',
  [PermissionClass.DB_WRITE]:     'high',
};

// ─── Scope Restrictions by Risk ──────────────────────────

export const SCOPE_RESTRICTIONS: Record<RiskLevel, ApprovalScope[]> = {
  low:      [ApprovalScope.ONCE, ApprovalScope.THIS_TASK, ApprovalScope.THIS_SESSION],
  medium:   [ApprovalScope.ONCE, ApprovalScope.THIS_TASK, ApprovalScope.THIS_SESSION],
  high:     [ApprovalScope.ONCE, ApprovalScope.THIS_TASK],  // sem sessão
  critical: [ApprovalScope.ONCE],                            // apenas uma vez
};

// ─── Approval Request Interface ──────────────────────────

export interface ApprovalRequest {
  action: string;
  detail: string;
  filesAffected: string[];
  riskLevel?: RiskLevel;
  permissionClass: PermissionClass;
}

export interface ApprovalResult {
  approved: boolean;
  scope?: ApprovalScope;
}

// ─── Approval Panel Renderer ─────────────────────────────

function renderRiskBar(risk: RiskLevel): string {
  const indicator = RISK_INDICATORS[risk];
  const colorFn = risk === 'critical' ? chalk.bgRed.white.bold :
                  risk === 'high' ? chalk.red :
                  risk === 'medium' ? chalk.yellow :
                  chalk.green;
  return colorFn(`${indicator.bar} ${indicator.label}`);
}

export function renderApprovalPanel(
  request: ApprovalRequest,
  risk: RiskLevel,
  availableScopes: ApprovalScope[]
): void {
  const isCritical = risk === 'critical';
  const border = isCritical ? chalk.red : chalk.gray;
  const header = isCritical ? '⚠ APROVAÇÃO CRÍTICA' : 'APROVAÇÃO';

  const lines: string[] = [];
  lines.push(border(`┌─ ${header} ${'─'.repeat(Math.max(0, 50 - header.length))}┐`));
  lines.push(border('│') + ' '.repeat(54) + border('│'));
  lines.push(border('│') + `  ${chalk.bold('Ação:')}    ${request.action}`.padEnd(54) + border('│'));
  lines.push(border('│') + `  ${chalk.bold('Detalhe:')} ${request.detail}`.padEnd(54) + border('│'));

  if (request.filesAffected.length > 0) {
    lines.push(border('│') + `  ${chalk.bold('Arquivos:')} ${request.filesAffected.join(', ')}`.padEnd(54) + border('│'));
  }

  lines.push(border('│') + `  ${chalk.bold('Risco:')}   ${renderRiskBar(risk)}`.padEnd(54) + border('│'));
  lines.push(border('│') + `  ${chalk.bold('Classe:')}  ${request.permissionClass}`.padEnd(54) + border('│'));
  lines.push(border('│') + ' '.repeat(54) + border('│'));

  // Scope options
  const scopeLabels: Record<ApprovalScope, string> = {
    [ApprovalScope.ONCE]:         'Aprovar uma vez',
    [ApprovalScope.THIS_TASK]:    'Aprovar nesta tarefa',
    [ApprovalScope.THIS_SESSION]: 'Aprovar nesta sessão',
  };

  availableScopes.forEach((scope, i) => {
    lines.push(border('│') + `  [${i + 1}] ${scopeLabels[scope]}`.padEnd(54) + border('│'));
  });
  lines.push(border('│') + `  [n] Negar`.padEnd(54) + border('│'));

  lines.push(border('│') + ' '.repeat(54) + border('│'));

  // Critical notes
  if (risk === 'critical') {
    lines.push(border('│') + chalk.yellow(`  NOTA: Ações críticas não permitem aprovação em lote.`).padEnd(54) + border('│'));
    lines.push(border('│') + ' '.repeat(54) + border('│'));
  } else if (risk === 'high') {
    lines.push(border('│') + chalk.yellow(`  NOTA: Ações de alto risco não permitem aprovação de sessão.`).padEnd(54) + border('│'));
    lines.push(border('│') + ' '.repeat(54) + border('│'));
  }

  lines.push(border(`└${'─'.repeat(55)}┘`));

  console.log('\n' + lines.join('\n') + '\n');
}

// ─── Main Approval Function ─────────────────────────────

/**
 * Request approval for an action.
 * Checks memory first, renders panel if needed, waits for user input.
 */
export async function requestApproval(
  request: ApprovalRequest,
  memory: ApprovalMemory,
  taskId: string = 'default'
): Promise<ApprovalResult> {
  const risk = request.riskLevel ?? PERMISSION_RISK_MAP[request.permissionClass];

  // Check if already approved
  if (memory.isApproved(request.permissionClass, taskId)) {
    return { approved: true, scope: ApprovalScope.THIS_SESSION };
  }

  // Determine available scopes
  const availableScopes = SCOPE_RESTRICTIONS[risk];

  // Render panel
  renderApprovalPanel(request, risk, availableScopes);

  // Wait for user input
  const choice = await waitForUserChoice(availableScopes);

  if (!choice) {
    return { approved: false };
  }

  // Record approval
  memory.approve(request.permissionClass, choice, taskId);

  return { approved: true, scope: choice };
}

async function waitForUserChoice(availableScopes: ApprovalScope[]): Promise<ApprovalScope | null> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(chalk.cyan('  Escolha: '), (answer) => {
      rl.close();

      const trimmed = answer.trim().toLowerCase();

      if (trimmed === 'n' || trimmed === 'no' || trimmed === 'não') {
        resolve(null);
        return;
      }

      const idx = parseInt(trimmed, 10) - 1;
      if (idx >= 0 && idx < availableScopes.length) {
        resolve(availableScopes[idx]);
      } else {
        // Invalid input = deny
        resolve(null);
      }
    });
  });
}


