/**
 * definitions.ts — Subagent type definitions for AurexAI CLI Agent
 *
 * Defines typed interfaces for all 4 subagents:
 * - security-reviewer
 * - architecture-reviewer
 * - researcher
 * - bug-investigator
 *
 * Reference: docs/architecture-reference/subagents/*.md
 */

// ─── Base Types ──────────────────────────────────────────

export type SubagentName =
  | "security-reviewer"
  | "architecture-reviewer"
  | "researcher"
  | "bug-investigator";

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export interface SubagentDefinition {
  name: SubagentName;
  specialty: string;
  systemPrompt: string;
  tools: string[];
  maxTokens: number;
}

export interface SubagentTask {
  task: string;
  scope?: "all" | "changed";
  files?: string[];
  context?: Record<string, unknown>;
  error?: string;
  stackTrace?: string;
}

// ─── Security Reviewer ──────────────────────────────────

export interface SecurityFinding {
  severity: Severity;
  category: string;
  file: string;
  line: number;
  description: string;
  impact: string;
  recommendation: string;
  codeExample: string;
}

export interface SecurityReviewResult {
  summary: {
    totalFindings: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  findings: SecurityFinding[];
  passed: boolean;
  recommendations: string[];
}

// ─── Architecture Reviewer ──────────────────────────────

export interface ArchitectureConcern {
  severity: "high" | "medium" | "low";
  area: string;
  issue: string;
  impact: string;
  recommendation: string;
  files: string[];
}

export interface ArchitectureReviewResult {
  assessment: string;
  strengths: string[];
  concerns: ArchitectureConcern[];
  patterns: {
    detected: string[];
    recommended: string[];
    antiPatterns: string[];
  };
  metrics: {
    moduleCount: number;
    avgFileSize: number;
    maxComplexity: {
      file: string;
      function: string;
      complexity: number;
    };
    circularDependencies: string[][];
  };
}

// ─── Researcher ─────────────────────────────────────────

export interface ResearchFinding {
  claim: string;
  evidence: string;
  source: string;
  confidence: "high" | "medium" | "low";
  date: string;
}

export interface ResearchSource {
  url: string;
  title: string;
  type: "official-docs" | "blog" | "github" | "stackoverflow" | "other";
  reliability: "high" | "medium" | "low";
}

export interface ResearchResult {
  query: string;
  summary: string;
  findings: ResearchFinding[];
  sources: ResearchSource[];
  limitations: string[];
  suggestions: string[];
}

// ─── Bug Investigator ───────────────────────────────────

export interface BugHypothesis {
  description: string;
  evidence_for: string[];
  evidence_against: string[];
  status: "confirmed" | "rejected" | "inconclusive";
}

export interface BugInvestigationResult {
  summary: string;
  reproduction: {
    steps: string[];
    command: string;
    output: string;
    reproduced: boolean;
  };
  hypotheses: BugHypothesis[];
  rootCause: {
    file: string;
    line: number;
    description: string;
    confidence: number;
    evidence: string[];
  };
  fix: {
    diff: string;
    explanation: string;
    risks: string[];
    testCommand: string;
  };
  relatedIssues: string[];
  regressionSince: string | null;
}

// ─── Union Result Type ──────────────────────────────────

export type SubagentResult =
  | { type: "security-review"; data: SecurityReviewResult }
  | { type: "architecture-review"; data: ArchitectureReviewResult }
  | { type: "research"; data: ResearchResult }
  | { type: "bug-investigation"; data: BugInvestigationResult };

// ─── Built-in Definitions ───────────────────────────────

export const SUBAGENT_DEFINITIONS: Record<SubagentName, SubagentDefinition> = {
  "security-reviewer": {
    name: "security-reviewer",
    specialty: "Revisão profunda de segurança",
    systemPrompt: `Você é um especialista em segurança de aplicações. Sua tarefa é analisar código, configuração e dependências buscando vulnerabilidades.

Você DEVE:
- Verificar OWASP Top 10 (XSS, SQL Injection, CSRF, etc.)
- Buscar secrets hardcoded (API keys, tokens, senhas)
- Analisar permissões e configurações de acesso
- Verificar dependências com CVEs conhecidos
- Analisar configuração de CORS, CSP, headers de segurança

Você NÃO PODE:
- Editar arquivos
- Executar comandos destrutivos

Formato: JSON com severity, file, line, description, impact, recommendation, codeExample.`,
    tools: ["fs_read", "fs_glob", "fs_grep", "web_search", "shell"],
    maxTokens: 32_000,
  },

  "architecture-reviewer": {
    name: "architecture-reviewer",
    specialty: "Revisão de arquitetura e design",
    systemPrompt: `Você é um arquiteto de software especializado em revisar design de código. Analise considerando:
- Separação de responsabilidades (SRP)
- Acoplamento entre módulos
- Coesão
- Padrões de design
- Escalabilidade e testabilidade

Foque em decisões arquiteturais, não em estilo de código.
Formato: JSON com assessment, strengths, concerns, patterns, metrics.`,
    tools: ["fs_read", "fs_glob", "fs_grep"],
    maxTokens: 32_000,
  },

  "researcher": {
    name: "researcher",
    specialty: "Pesquisa profunda na web e documentação",
    systemPrompt: `Você é um pesquisador técnico. Encontre informação precisa e atualizada.

Você DEVE:
- Pesquisar com queries específicas
- Consultar múltiplas fontes (mínimo 2)
- Citar fontes com URL
- Distinguir fato confirmado de suposição

Você NÃO PODE:
- Inventar informação sem fonte
- Editar arquivos ou executar comandos

Formato: JSON com query, summary, findings, sources, limitations, suggestions.`,
    tools: ["web_search", "web_fetch", "fs_read"],
    maxTokens: 32_000,
  },

  "bug-investigator": {
    name: "bug-investigator",
    specialty: "Investigação profunda de bugs",
    systemPrompt: `Você é um investigador de bugs. Abordagem científica:
1. Coletar dados: erro, logs, stack trace
2. Formular hipóteses (máx 3)
3. Testar cada hipótese com evidência
4. Convergir para causa raiz
5. Propor correção mínima

Você DEVE: citar arquivo e linha, mostrar evidência real, propor correção mínima.
Você NÃO PODE: concluir sem evidência, pular reprodução.

Formato: JSON com summary, reproduction, hypotheses, rootCause, fix.`,
    tools: ["fs_read", "fs_grep", "fs_glob", "shell", "web_search", "git"],
    maxTokens: 32_000,
  },
};
