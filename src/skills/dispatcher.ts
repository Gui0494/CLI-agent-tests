/**
 * dispatcher.ts — Skill dispatcher for AurexAI CLI Agent
 *
 * Selects and executes skills, managing the lifecycle:
 * validate prerequisites → execute steps → handle errors → return result.
 *
 * Wired into AgentLoop via AppContext.skillDispatcher.
 *
 * Reference: docs/architecture-reference/specs/skill-user.md §4
 */

import chalk from "chalk";
import { SkillDefinition, SkillStep, SkillLoader } from "./loader.js";
import { Mode } from "../agent/modes.js";

// ─── Interfaces ──────────────────────────────────────────

export interface SkillContext {
  mode: Mode;
  inputs: Record<string, unknown>;
  availableTools: Set<string>;
  executor: {
    run(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  };
}

export interface StepResult {
  stepId: string;
  success: boolean;
  output: string;
  error?: string;
  skipped?: boolean;
}

export interface SkillResult {
  skillName: string;
  success: boolean;
  steps: StepResult[];
  summary: string;
  durationMs: number;
}

export type SkillErrorRecovery = 'retry' | 'skip' | 'abort' | 'ask_user';

export interface SkillError {
  skillName: string;
  step: string;
  error: string;
  recovery: SkillErrorRecovery;
  suggestion: string;
}

// ─── Skill Dispatcher ───────────────────────────────────

export class SkillDispatcher {
  constructor(private loader: SkillLoader) {}

  /**
   * Execute a skill by name with the given context.
   */
  async execute(skillName: string, context: SkillContext): Promise<SkillResult> {
    const skill = this.loader.get(skillName);
    if (!skill) {
      return {
        skillName,
        success: false,
        steps: [],
        summary: `Skill "${skillName}" não encontrada. Use /skills para listar disponíveis.`,
        durationMs: 0,
      };
    }

    return this.executeSkill(skill, context);
  }

  /**
   * Execute a specific skill definition.
   */
  async executeSkill(skill: SkillDefinition, context: SkillContext): Promise<SkillResult> {
    const start = Date.now();
    const stepResults: StepResult[] = [];

    // 1. Validate prerequisites
    const missingTools = skill.requiredTools.filter(t => !context.availableTools.has(t));
    if (missingTools.length > 0) {
      return {
        skillName: skill.name,
        success: false,
        steps: [],
        summary: `Skill "${skill.name}" requer tools não disponíveis: ${missingTools.join(', ')}`,
        durationMs: Date.now() - start,
      };
    }

    // 2. Validate required inputs
    const missingInputs = skill.inputs
      .filter(i => i.required && !(i.name in context.inputs))
      .map(i => i.name);
    if (missingInputs.length > 0) {
      return {
        skillName: skill.name,
        success: false,
        steps: [],
        summary: `Skill "${skill.name}" requer inputs: ${missingInputs.join(', ')}`,
        durationMs: Date.now() - start,
      };
    }

    // 3. Execute steps
    console.log(chalk.cyan(`\n🔧 Executando skill: ${skill.name}`));
    console.log(chalk.gray(`   ${skill.description}\n`));

    let aborted = false;

    for (const step of skill.steps) {
      if (aborted) break;

      // Check timeout
      const elapsed = Date.now() - start;
      if (elapsed > skill.limits.maxDuration * 1000) {
        stepResults.push({
          stepId: step.id,
          success: false,
          output: '',
          error: `Timeout: ultrapassou limite de ${skill.limits.maxDuration}s`,
        });
        break;
      }

      // Check condition
      if (step.condition && !this.evaluateCondition(step.condition, stepResults)) {
        stepResults.push({
          stepId: step.id,
          success: true,
          output: 'Condição não atendida, passo pulado',
          skipped: true,
        });
        continue;
      }

      console.log(chalk.gray(`   → Step ${step.id}: ${step.action}`));

      const stepResult = await this.executeStep(step, context, stepResults);
      stepResults.push(stepResult);

      if (!stepResult.success && !stepResult.skipped) {
        switch (step.onError) {
          case 'abort':
            console.log(chalk.red(`   ✗ Step ${step.id} falhou — abortando skill`));
            if (step.errorMessage) console.log(chalk.yellow(`     ${step.errorMessage}`));
            aborted = true;
            break;
          case 'skip':
            console.log(chalk.yellow(`   ⚠ Step ${step.id} falhou — continuando`));
            break;
          case 'continue':
            console.log(chalk.yellow(`   ⚠ Step ${step.id} falhou — continuando`));
            break;
          case 'retry': {
            console.log(chalk.yellow(`   ⚠ Step ${step.id} falhou — tentando novamente`));
            const retryResult = await this.executeStep(step, context, stepResults);
            stepResults.push(retryResult);
            if (!retryResult.success) {
              console.log(chalk.red(`   ✗ Step ${step.id} falhou no retry — abortando`));
              aborted = true;
            }
            break;
          }
          default:
            aborted = true;
        }
      } else if (stepResult.success && !stepResult.skipped) {
        console.log(chalk.green(`   ✓ Step ${step.id} concluído`));
      }
    }

    const allPassed = stepResults.filter(s => !s.skipped).every(s => s.success);
    const summary = allPassed
      ? `Skill "${skill.name}" executada com sucesso.`
      : `Skill "${skill.name}" completada com erros.`;

    console.log(allPassed
      ? chalk.green(`\n   ✓ ${summary}`)
      : chalk.yellow(`\n   ⚠ ${summary}`)
    );

    return {
      skillName: skill.name,
      success: allPassed,
      steps: stepResults,
      summary,
      durationMs: Date.now() - start,
    };
  }

  /**
   * List all skills with formatting.
   */
  formatSkillList(availableTools: Set<string>): string {
    const statuses = this.loader.getAllWithStatus(availableTools);
    if (statuses.length === 0) {
      return chalk.gray("  Nenhuma skill encontrada. Adicione arquivos YAML em skills/");
    }

    const lines = [chalk.bold.cyan("\nSkills disponíveis:\n")];
    for (const status of statuses) {
      const icon = status.available ? chalk.green("●") : chalk.yellow("○");
      const name = chalk.bold(status.skill.name.padEnd(25));
      const desc = chalk.gray(status.skill.description);
      const avail = status.available
        ? chalk.green("[disponível]")
        : chalk.yellow(`[requer ${status.missingTools.join(', ')}]`);
      lines.push(`  ${icon} ${name} ${desc}  ${avail}`);
    }
    lines.push("");
    return lines.join("\n");
  }

  // ─── Private Methods ────────────────────────────────────

  private async executeStep(
    step: SkillStep,
    context: SkillContext,
    _previousResults: StepResult[]
  ): Promise<StepResult> {
    try {
      // "none" tool means this step only produces output text
      if (!step.tool || step.tool === 'none') {
        return {
          stepId: step.id,
          success: true,
          output: step.output || step.action,
        };
      }

      // Shell command execution
      if (step.tool === 'shell' || step.tool === 'exec_command') {
        const cmd = this.interpolateCommand(step.command || '', context.inputs);
        const result = await context.executor.run(cmd);
        return {
          stepId: step.id,
          success: result.exitCode === 0,
          output: result.stdout || result.stderr || '',
          error: result.exitCode !== 0 ? (result.stderr || `Exit code: ${result.exitCode}`) : undefined,
        };
      }

      // File read
      if (step.tool === 'fs_read' || step.tool === 'read_file') {
        const { readFile } = await import("../editor/file-ops.js");
        const p = this.interpolateCommand(step.path || '', context.inputs);
        const content = await readFile(p);
        return {
          stepId: step.id,
          success: true,
          output: content.slice(0, 5000),
        };
      }

      // Default: unknown tool, just report
      return {
        stepId: step.id,
        success: false,
        output: '',
        error: `Tool "${step.tool}" não suportado no dispatcher de skills`,
      };
    } catch (err: unknown) {
      return {
        stepId: step.id,
        success: false,
        output: '',
        error: (err as Error).message,
      };
    }
  }

  private interpolateCommand(template: string, inputs: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return String(inputs[key] ?? '');
    });
  }

  private evaluateCondition(condition: string, results: StepResult[]): boolean {
    // Simple condition evaluator: "step.<id>.exit_code != 0"
    const match = condition.match(/step\.(\w+)\.(exit_code|success)\s*(!=|==)\s*(\d+|true|false)/);
    if (!match) return true; // can't evaluate, assume true

    const [, stepId, field, operator, value] = match;
    const step = results.find(r => r.stepId === stepId);
    if (!step) return true; // step hasn't run yet, assume true

    if (field === 'success') {
      const expectedBool = value === 'true';
      return operator === '==' ? step.success === expectedBool : step.success !== expectedBool;
    }

    // exit_code comparison (approximate: !success means non-zero)
    const exitCode = step.success ? 0 : 1;
    const expected = parseInt(value);
    return operator === '==' ? exitCode === expected : exitCode !== expected;
  }
}
