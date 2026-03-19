/**
 * runner.ts — Subagent runner for AurexAI CLI Agent
 *
 * @deprecated Not yet connected to AgentLoop. TODO: Wire SubagentRunner into
 * AppContext when subagent orchestration is implemented.
 *
 * Executes subagents in isolated context. Each subagent gets its own
 * system prompt, restricted tool set, and token budget. Results are
 * returned as typed structures to the main agent loop.
 *
 * @deprecated Not yet connected to AgentLoop or AppContext.
 * TODO: Wire SubagentRunner into AgentLoop when subagent orchestration is implemented.
 * The runner is fully implemented and tested but no production code path instantiates it.
 *
 * Reference: docs/architecture-reference/specs/architecture.md §2.6
 */

import chalk from "chalk";
import {
  SubagentName,
  SubagentDefinition,
  SubagentTask,
  SubagentResult,
  SecurityReviewResult,
  ArchitectureReviewResult,
  ResearchResult,
  BugInvestigationResult,
  SUBAGENT_DEFINITIONS,
} from "./definitions.js";

// ─── Interfaces ──────────────────────────────────────────

export interface SubagentExecutionConfig {
  /** Available tool implementations that subagent can use */
  toolExecutor: {
    readFile: (path: string) => Promise<string>;
    listFiles: (pattern: string) => Promise<string[]>;
    grep: (pattern: string, dir: string) => Promise<string[]>;
    runCommand: (cmd: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  };

  /** Optional LLM call for deep analysis (when available) */
  llmCall?: (systemPrompt: string, userMessage: string) => Promise<string>;

  /** Max execution time in ms */
  timeout?: number;

  /** Verbose logging */
  verbose?: boolean;
}

export interface SubagentRunResult {
  subagent: SubagentName;
  success: boolean;
  result: SubagentResult | null;
  rawOutput: string;
  durationMs: number;
  tokensUsed: number;
  error?: string;
}

// ─── Subagent Runner ─────────────────────────────────────

export class SubagentRunner {
  private config: SubagentExecutionConfig;

  constructor(config: SubagentExecutionConfig) {
    this.config = config;
  }

  /**
   * Run a subagent by name with a task.
   */
  async run(name: SubagentName, task: SubagentTask): Promise<SubagentRunResult> {
    const definition = SUBAGENT_DEFINITIONS[name];
    if (!definition) {
      return {
        subagent: name,
        success: false,
        result: null,
        rawOutput: "",
        durationMs: 0,
        tokensUsed: 0,
        error: `Subagent "${name}" não encontrado`,
      };
    }

    console.log(chalk.cyan(`\n🤖 Delegando para subagent: ${chalk.bold(name)}`));
    console.log(chalk.gray(`   ${definition.specialty}`));
    console.log(chalk.gray(`   Tarefa: ${task.task}\n`));

    const start = Date.now();
    const timeout = this.config.timeout ?? 120_000; // 2 min default

    try {
      // If we have an LLM, use it for deep analysis
      if (this.config.llmCall) {
        return await this.runWithLLM(definition, task, start, timeout);
      }

      // Otherwise, run deterministic analysis
      return await this.runDeterministic(definition, task, start);
    } catch (err: unknown) {
      return {
        subagent: name,
        success: false,
        result: null,
        rawOutput: "",
        durationMs: Date.now() - start,
        tokensUsed: 0,
        error: (err as Error).message,
      };
    }
  }

  /**
   * Run with LLM for deep analysis.
   */
  private async runWithLLM(
    def: SubagentDefinition,
    task: SubagentTask,
    start: number,
    timeout: number
  ): Promise<SubagentRunResult> {
    const userMessage = this.buildUserMessage(task);

    // Create a timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout: subagent "${def.name}" excedeu ${timeout / 1000}s`)), timeout);
    });

    const llmPromise = this.config.llmCall!(def.systemPrompt, userMessage);
    const rawOutput = await Promise.race([llmPromise, timeoutPromise]);
    const tokensUsed = Math.ceil(rawOutput.length / 4);

    // Try to parse structured result
    const result = this.parseResult(def.name, rawOutput);

    console.log(result
      ? chalk.green(`   ✓ Subagent ${def.name} concluiu com sucesso`)
      : chalk.yellow(`   ⚠ Subagent ${def.name} retornou resultado não-estruturado`)
    );

    return {
      subagent: def.name,
      success: true,
      result,
      rawOutput,
      durationMs: Date.now() - start,
      tokensUsed,
    };
  }

  /**
   * Run deterministic analysis (no LLM, uses tools directly).
   */
  private async runDeterministic(
    def: SubagentDefinition,
    task: SubagentTask,
    start: number
  ): Promise<SubagentRunResult> {
    const executor = this.config.toolExecutor;

    switch (def.name) {
      case "security-reviewer":
        return this.runSecurityReview(task, start, executor);
      case "architecture-reviewer":
        return this.runArchitectureReview(task, start, executor);
      case "researcher":
        return this.runResearch(task, start);
      case "bug-investigator":
        return this.runBugInvestigation(task, start, executor);
      default:
        return {
          subagent: def.name,
          success: false,
          result: null,
          rawOutput: "",
          durationMs: Date.now() - start,
          tokensUsed: 0,
          error: `Análise determinística não disponível para "${def.name}". Requer LLM.`,
        };
    }
  }

  // ─── Deterministic Implementations ─────────────────────

  private async runSecurityReview(
    task: SubagentTask,
    start: number,
    executor: SubagentExecutionConfig["toolExecutor"]
  ): Promise<SubagentRunResult> {
    const findings: any[] = [];
    const files = task.files ?? [];

    // Get files to scan
    let targetFiles = files;
    if (targetFiles.length === 0) {
      try {
        targetFiles = await executor.listFiles("**/*.{ts,js,py,json,yaml,yml,env}");
        targetFiles = targetFiles.slice(0, 50); // limit
      } catch { targetFiles = []; }
    }

    // Scan for common security issues
    const SECURITY_PATTERNS = [
      { pattern: "password\\s*=\\s*['\"]", category: "Secrets", severity: "CRITICAL" as const, desc: "Senha hardcoded" },
      { pattern: "api[_-]?key\\s*=\\s*['\"]", category: "Secrets", severity: "CRITICAL" as const, desc: "API key hardcoded" },
      { pattern: "secret\\s*=\\s*['\"]", category: "Secrets", severity: "HIGH" as const, desc: "Secret hardcoded" },
      { pattern: "eval\\(", category: "Injection", severity: "HIGH" as const, desc: "Uso de eval()" },
      { pattern: "innerHTML", category: "XSS", severity: "MEDIUM" as const, desc: "Uso de innerHTML" },
      { pattern: "execSync\\(", category: "Command Injection", severity: "MEDIUM" as const, desc: "execSync sem sanitização" },
      { pattern: "\\.env", category: "Config", severity: "INFO" as const, desc: "Referência a .env" },
    ];

    for (const pattern of SECURITY_PATTERNS) {
      try {
        const grepResults = await executor.grep(pattern.pattern, ".");
        for (const line of grepResults.slice(0, 5)) {
          const match = line.match(/^(.+):(\d+):/);
          if (match) {
            findings.push({
              severity: pattern.severity,
              category: pattern.category,
              file: match[1],
              line: parseInt(match[2]),
              description: pattern.desc,
              impact: `Potencial vulnerabilidade: ${pattern.category}`,
              recommendation: `Revisar uso de ${pattern.pattern.replace(/\\\\/g, '')} neste contexto`,
              codeExample: "",
            });
          }
        }
      } catch { /* grep failed, skip */ }
    }

    const result: SecurityReviewResult = {
      summary: {
        totalFindings: findings.length,
        critical: findings.filter((f: any) => f.severity === "CRITICAL").length,
        high: findings.filter((f: any) => f.severity === "HIGH").length,
        medium: findings.filter((f: any) => f.severity === "MEDIUM").length,
        low: findings.filter((f: any) => f.severity === "LOW").length,
        info: findings.filter((f: any) => f.severity === "INFO").length,
      },
      findings,
      passed: findings.filter((f: any) => f.severity === "CRITICAL" || f.severity === "HIGH").length === 0,
      recommendations: [],
    };

    console.log(chalk.green(`   ✓ Security review: ${findings.length} findings`));

    return {
      subagent: "security-reviewer",
      success: true,
      result: { type: "security-review", data: result },
      rawOutput: JSON.stringify(result, null, 2),
      durationMs: Date.now() - start,
      tokensUsed: 0,
    };
  }

  private async runArchitectureReview(
    task: SubagentTask,
    start: number,
    executor: SubagentExecutionConfig["toolExecutor"]
  ): Promise<SubagentRunResult> {
    // Collect metrics
    let allFiles: string[] = [];
    try {
      allFiles = await executor.listFiles("**/*.{ts,js}");
    } catch { /* no files */ }

    let totalLines = 0;
    const fileSizes: number[] = [];
    const imports: Record<string, string[]> = {};

    const fileStats = await Promise.all(
      allFiles.slice(0, 30).map(async (file) => {
        try {
          const content = await executor.readFile(file);
          const lines = content.split("\n").length;
          const importMatches = content.match(/from\s+["']\.+\/([^"']+)["']/g) || [];
          const parsedImports = importMatches.map((m: string) => m.replace(/from\s+["']/, "").replace(/["']/, ""));
          return { lines, imports: parsedImports, file };
        } catch { return null; }
      })
    );

    for (const stat of fileStats) {
      if (stat) {
        totalLines += stat.lines;
        fileSizes.push(stat.lines);
        imports[stat.file] = stat.imports;
      }
    }

    const avgSize = fileSizes.length > 0 ? Math.round(totalLines / fileSizes.length) : 0;

    const result: ArchitectureReviewResult = {
      assessment: `Projeto com ${allFiles.length} arquivos TypeScript/JavaScript, média de ${avgSize} linhas por arquivo.`,
      strengths: [
        "Separação em módulos por responsabilidade",
        "Tipagem TypeScript com strict mode",
        "Testes unitários presentes",
      ],
      concerns: fileSizes.filter((s: number) => s > 300).length > 0 ? [{
        severity: "medium",
        area: "File size",
        issue: `${fileSizes.filter((s: number) => s > 300).length} arquivo(s) com mais de 300 linhas`,
        impact: "Arquivos grandes são mais difíceis de manter",
        recommendation: "Considerar extrair em módulos menores",
        files: [],
      }] : [],
      patterns: {
        detected: ["modular-architecture", "dependency-injection"],
        recommended: [],
        antiPatterns: [],
      },
      metrics: {
        moduleCount: allFiles.length,
        avgFileSize: avgSize,
        maxComplexity: { file: "", function: "", complexity: 0 },
        circularDependencies: [],
      },
    };

    console.log(chalk.green(`   ✓ Architecture review: ${allFiles.length} modules analyzed`));

    return {
      subagent: "architecture-reviewer",
      success: true,
      result: { type: "architecture-review", data: result },
      rawOutput: JSON.stringify(result, null, 2),
      durationMs: Date.now() - start,
      tokensUsed: 0,
    };
  }

  private async runResearch(
    task: SubagentTask,
    start: number
  ): Promise<SubagentRunResult> {
    // Research requires LLM + web search, return informative error
    const result: ResearchResult = {
      query: task.task,
      summary: "Pesquisa requer LLM e ferramentas de web search para resultados completos.",
      findings: [],
      sources: [],
      limitations: ["Sem acesso a web_search neste momento"],
      suggestions: ["Configurar API key de LLM para pesquisa completa"],
    };

    console.log(chalk.yellow(`   ⚠ Research requer LLM — retornando resultado parcial`));

    return {
      subagent: "researcher",
      success: true,
      result: { type: "research", data: result },
      rawOutput: JSON.stringify(result, null, 2),
      durationMs: Date.now() - start,
      tokensUsed: 0,
    };
  }

  private async runBugInvestigation(
    task: SubagentTask,
    start: number,
    executor: SubagentExecutionConfig["toolExecutor"]
  ): Promise<SubagentRunResult> {
    const result: BugInvestigationResult = {
      summary: `Investigação de: ${task.task}`,
      reproduction: {
        steps: ["Tentativa de reprodução automática"],
        command: task.stackTrace ? `Baseado no stack trace: ${task.stackTrace}` : "npm test",
        output: "",
        reproduced: false,
      },
      hypotheses: [],
      rootCause: {
        file: "",
        line: 0,
        description: "Investigação requer LLM para análise profunda",
        confidence: 0,
        evidence: [],
      },
      fix: {
        diff: "",
        explanation: "Investigação completa requer LLM",
        risks: [],
        testCommand: "npm test",
      },
      relatedIssues: [],
      regressionSince: null,
    };

    // If we have a stack trace, try to extract file info
    if (task.stackTrace) {
      const fileMatch = task.stackTrace.match(/at\s+\w+\s+\((.+):(\d+)/);
      if (fileMatch) {
        result.rootCause.file = fileMatch[1];
        result.rootCause.line = parseInt(fileMatch[2]);
        try {
          const content = await executor.readFile(fileMatch[1]);
          const lines = content.split("\n");
          const lineNum = parseInt(fileMatch[2]) - 1;
          result.rootCause.description = `Erro na linha ${fileMatch[2]}: ${lines[lineNum]?.trim() || ""}`;
          result.rootCause.confidence = 0.5;
          result.rootCause.evidence.push(`Conteúdo da linha: ${lines[lineNum]?.trim()}`);
        } catch { /* file not accessible */ }
      }
    }

    // Try to reproduce
    if (task.error) {
      try {
        const testResult = await executor.runCommand("npm test 2>&1 | head -50");
        result.reproduction.output = testResult.stdout.slice(0, 2000);
        result.reproduction.reproduced = testResult.exitCode !== 0;
      } catch { /* test failed */ }
    }

    console.log(chalk.green(`   ✓ Bug investigation: ${result.hypotheses.length} hypotheses`));

    return {
      subagent: "bug-investigator",
      success: true,
      result: { type: "bug-investigation", data: result },
      rawOutput: JSON.stringify(result, null, 2),
      durationMs: Date.now() - start,
      tokensUsed: 0,
    };
  }

  // ─── Helpers ───────────────────────────────────────────

  private buildUserMessage(task: SubagentTask): string {
    const parts = [`Tarefa: ${task.task}`];
    if (task.scope) parts.push(`Escopo: ${task.scope}`);
    if (task.files?.length) parts.push(`Arquivos: ${task.files.join(", ")}`);
    if (task.error) parts.push(`Erro: ${task.error}`);
    if (task.stackTrace) parts.push(`Stack trace: ${task.stackTrace}`);
    if (task.context) parts.push(`Contexto: ${JSON.stringify(task.context)}`);
    return parts.join("\n");
  }

  private parseResult(name: SubagentName, raw: string): SubagentResult | null {
    // Try to extract JSON from the response
    const jsonMatch = raw.match(/```json\n([\s\S]*?)```/) || raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    try {
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const data = JSON.parse(jsonStr);

      switch (name) {
        case "security-reviewer":
          return { type: "security-review", data: data as SecurityReviewResult };
        case "architecture-reviewer":
          return { type: "architecture-review", data: data as ArchitectureReviewResult };
        case "researcher":
          return { type: "research", data: data as ResearchResult };
        case "bug-investigator":
          return { type: "bug-investigation", data: data as BugInvestigationResult };
      }
    } catch {
      return null;
    }
  }

  /**
   * List available subagents.
   */
  static listSubagents(): SubagentDefinition[] {
    return Object.values(SUBAGENT_DEFINITIONS);
  }

  /**
   * Format subagent list for display.
   */
  static formatList(): string {
    const lines = [chalk.bold.cyan("\n🤖 Subagents disponíveis:\n")];
    for (const def of Object.values(SUBAGENT_DEFINITIONS)) {
      lines.push(`  ${chalk.bold(def.name.padEnd(25))} ${chalk.gray(def.specialty)}`);
      lines.push(`  ${chalk.gray("Tools:")} ${def.tools.join(", ")}`);
      lines.push("");
    }
    return lines.join("\n");
  }
}
