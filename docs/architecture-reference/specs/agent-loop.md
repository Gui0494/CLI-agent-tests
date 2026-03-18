# Agent Loop — Especificação

## 1. Visão Geral

O agent loop é o núcleo de execução do CLI Agent. Ele recebe uma tarefa, interage com o LLM, seleciona ferramentas, executa ações reais, verifica resultados e se autocorrige.

## 2. Diagrama do Loop

```
                    ┌──────────────┐
                    │   USER INPUT │
                    └──────┬───────┘
                           │
                           ▼
                  ┌────────────────┐
                  │  MODE GATE     │
                  │  ┌───────────┐ │
                  │  │CHAT       │ │──▶ resposta direta, sem tools destrutivos
                  │  │PLAN       │ │──▶ gera plano, sem execução
                  │  │ACT        │ │──▶ execução com permissão
                  │  │AUTO       │ │──▶ plan+act em loop
                  │  │RESEARCH   │ │──▶ pesquisa, sem edição
                  │  └───────────┘ │
                  └────────┬───────┘
                           │
                           ▼
                  ┌────────────────┐
                  │  BUILD CONTEXT │
                  │  - session     │
                  │  - conversation│
                  │  - file cache  │
                  │  - plan state  │
                  │  - project ctx │
                  └────────┬───────┘
                           │
                           ▼
                  ┌────────────────┐
                  │  LLM CALL      │
                  │  system prompt │
                  │  + context     │
                  │  + tools avail │
                  └────────┬───────┘
                           │
                           ▼
                  ┌────────────────┐
                  │  PARSE RESPONSE│
                  │  ┌───────────┐ │
                  │  │text only  │ │──▶ renderiza resposta
                  │  │tool calls │ │──▶ continua para execução
                  │  │error      │ │──▶ retry LLM call
                  │  └───────────┘ │
                  └────────┬───────┘
                           │ (tool calls)
                           ▼
              ┌────────────────────────┐
              │  PERMISSION CHECK      │
              │  ┌──────────────────┐  │
              │  │ allow → executa  │  │
              │  │ ask → pergunta   │  │
              │  │ deny → bloqueia  │  │
              │  └──────────────────┘  │
              └────────────┬───────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  HOOKS: pre-execution  │
              │  - command blocklist   │
              │  - workspace sandbox   │
              │  - custom hooks        │
              └────────────┬───────────┘
                           │
                    ┌──────┴──────┐
                    │  BLOCKED?   │
                    ├─ YES ──▶ notifica usuário, aborta tool call
                    └─ NO ───▶ continua
                           │
                           ▼
              ┌────────────────────────┐
              │  EXECUTE TOOL          │
              │  - captura stdout      │
              │  - captura stderr      │
              │  - captura exit code   │
              │  - timeout protection  │
              └────────────┬───────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  HOOKS: post-execution │
              │  - formatter/lint      │
              │  - logging             │
              └────────────┬───────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  VERIFY RESULT         │
              │  ┌──────────────────┐  │
              │  │ success          │──▶ adiciona resultado ao contexto
              │  │ error retryable  │──▶ AUTOCORRECT (volta para LLM)
              │  │ error fatal      │──▶ reporta ao usuário
              │  │ more tools needed│──▶ volta para LLM CALL
              │  └──────────────────┘  │
              └────────────┬───────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  LLM tem mais calls?   │
              │  ├─ SIM → volta p/ LLM │
              │  └─ NÃO → renderiza    │
              └────────────────────────┘
```

## 3. Mode Gate — Detalhamento

O mode gate é a primeira verificação do loop. Ele restringe quais tools estão disponíveis baseado no modo atual.

```typescript
// IMPORTANTE: A fonte de verdade para permissões é specs/contracts.md seção 5.
// Este trecho é uma visão simplificada. Para a matriz completa com 12 classes
// de permissão (read, write-local, shell-safe, shell-unsafe, git-local,
// git-remote, network, install, preview, deploy, publish, db-write),
// consulte contracts.md → MODE_PERMISSION_MATRIX.

// Visão simplificada por modo:
//
// CHAT:     apenas leitura (fs_read, fs_glob, fs_grep)
// PLAN:     leitura + pesquisa web (web_search, web_fetch)
// ACT:      tudo com aprovação individual (ask)
// AUTO:     leitura/escrita/shell-safe/git-local/rede/preview liberados;
//           shell-unsafe/git-remote/install SEMPRE pedem confirmação;
//           deploy/publish/db-write SEMPRE negados
// RESEARCH: leitura + pesquisa web

// Exemplo de resolução de permissão:
function resolvePermission(mode: Mode, toolCall: ToolCall): PermissionLevel {
  // 1. Determinar classe de permissão da tool
  const permClass = TOOL_PERMISSION_MAP[toolCall.tool];

  // 2. Se é shell, reclassificar baseado no comando
  if (permClass === PermissionClass.SHELL_SAFE && isInWarnList(toolCall.command)) {
    permClass = PermissionClass.SHELL_UNSAFE;
  }

  // 3. Consultar matriz
  return MODE_PERMISSION_MATRIX[mode][permClass];
}
```

## 4. Autocorreção

O agent deve se autocorrigir quando detecta erro na execução de uma ferramenta.

### Fluxo de autocorreção:

```
ERRO DETECTADO
    │
    ▼
É retryable? ──── NÃO ──▶ reporta erro ao usuário
    │
    YES
    │
    ▼
Tentativas < MAX_RETRIES? ── NÃO ──▶ reporta erro + tentativas ao usuário
    │
    YES
    │
    ▼
Envia ao LLM:
  "O comando X falhou com erro Y.
   stdout: ...
   stderr: ...
   exit code: N
   Analise o erro e tente uma abordagem diferente."
    │
    ▼
LLM propõe correção
    │
    ▼
Volta para EXECUTE TOOL
```

### Configuração:

```typescript
interface RetryConfig {
  maxRetries: number;          // padrão: 3
  retryableErrors: string[];   // patterns de erro que permitem retry
  fatalErrors: string[];       // patterns que abortam imediatamente
  backoff: 'none' | 'linear' | 'exponential';
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  retryableErrors: [
    'ENOENT',           // arquivo não encontrado
    'EACCES',           // permissão negada (pode corrigir com sudo ask)
    'SyntaxError',      // erro de sintaxe em código gerado
    'TypeError',        // erro de tipo
    'exit code 1',      // falha genérica de comando
    'compilation error',
    'test failed',
    'lint error',
  ],
  fatalErrors: [
    'ENOMEM',           // sem memória
    'ENOSPC',           // sem espaço em disco
    'SIGKILL',          // processo morto
    'exit code 137',    // OOM killed
  ],
  backoff: 'none',      // sem delay entre retries (LLM já demora)
};
```

## 5. Context Building

Antes de cada LLM call, o loop monta o contexto:

```typescript
interface AgentContext {
  // Prompt do sistema (baseado no modo atual)
  systemPrompt: string;

  // Histórico de conversa (comprimido se necessário)
  conversation: Message[];

  // Estado da sessão
  session: {
    mode: Mode;
    currentTask: string | null;
    activePlan: Plan | null;
    iteration: number;
    maxIterations: number;
  };

  // Contexto do projeto (preenchido por repo-intel)
  project: {
    stack: string[];
    structure: string;
    buildCommand: string | null;
    testCommand: string | null;
    lintCommand: string | null;
  } | null;

  // Tools disponíveis (filtradas pelo mode gate)
  availableTools: ToolDefinition[];

  // Resultados recentes de tools (para referência do LLM)
  recentToolResults: ToolResult[];
}
```

## 6. Proteções do Loop

### 6.1 Infinite Loop Protection

```typescript
const LOOP_LIMITS = {
  maxIterationsPerTask: 50,        // máximo de iterações por tarefa
  maxToolCallsPerIteration: 10,    // máximo de tool calls por iteração
  maxConsecutiveErrors: 5,         // erros consecutivos antes de abortar
  maxTokensPerSession: 200_000,    // tokens máximos por sessão
  idleTimeout: 300_000,            // 5 min sem ação → pausa
};
```

### 6.2 Hallucination Guard

O agent deve ser impedido de alucinar resultados:

```typescript
function validateToolResult(result: ToolResult): boolean {
  // Tool retornou resultado real?
  if (result.source !== 'execution') {
    throw new Error('Tool result must come from real execution');
  }

  // Stdout/stderr estão presentes?
  if (result.type === 'shell' && result.stdout === undefined) {
    throw new Error('Shell execution must capture stdout');
  }

  // File content é real?
  if (result.type === 'fs_read' && !existsSync(result.path)) {
    throw new Error('File read must reference existing file');
  }

  return true;
}
```

### 6.3 Mode Enforcement

```typescript
function enforceModeConstraints(mode: Mode, toolCall: ToolCall): void {
  const allowed = MODE_TOOL_MATRIX[mode];
  const rule = allowed.find(r => r.tool === toolCall.tool || r.tool === '*');

  if (!rule || rule.permission === 'deny') {
    throw new ModeViolationError(
      `Tool "${toolCall.tool}" is not allowed in ${mode} mode. ` +
      `Switch to appropriate mode first.`
    );
  }
}
```

## 7. Output Format

O loop retorna resultado estruturado para a UI:

```typescript
interface LoopOutput {
  type: 'text' | 'code' | 'diff' | 'plan' | 'error' | 'preview' | 'table';

  content: string;

  metadata: {
    mode: Mode;
    toolsUsed: string[];
    iterations: number;
    tokensUsed: number;
    duration: number;
    autoCorrections: number;
  };

  // Para preview
  preview?: {
    url: string;
    type: 'web' | 'image' | 'terminal';
    pid: number;      // PID do servidor para cleanup
  };

  // Para planos
  plan?: {
    steps: PlanStep[];
    risks: string[];
    affectedFiles: string[];
  };
}
```

## 8. Sequência Completa — Exemplo Real

**Usuário:** "Adicione um botão de dark mode no header"

**Modo:** ACT

```
1. MODE GATE: ACT → tools de edição permitidos (com ask)

2. BUILD CONTEXT:
   - Lê project context (React + TypeScript + Tailwind)
   - Carrega conversation history
   - Lista tools disponíveis

3. LLM CALL #1:
   LLM decide: preciso ler o Header component primeiro
   → tool_call: fs_read("src/components/Header.tsx")

4. PERMISSION: fs_read → allow
5. HOOK PRE: nenhum para leitura
6. EXECUTE: lê arquivo real do disco
7. HOOK POST: nenhum para leitura
8. VERIFY: arquivo lido com sucesso, conteúdo no contexto

9. LLM CALL #2:
   LLM analisa o Header e decide editar
   → tool_call: fs_write("src/components/Header.tsx", novo_conteudo)

10. PERMISSION: fs_write → ask → usuário aprova
11. HOOK PRE: workspace sandbox check → dentro do workspace ✓
12. EXECUTE: escreve arquivo real no disco
13. HOOK POST: roda prettier no arquivo editado
14. VERIFY: arquivo salvo, sem erros de formatação

15. LLM CALL #3:
    LLM decide rodar testes
    → tool_call: shell("npm test -- --filter Header")

16. PERMISSION: shell → ask → usuário aprova
17. HOOK PRE: command blocklist check → não está na blocklist ✓
18. EXECUTE: roda npm test, captura stdout/stderr
19. VERIFY: testes passaram (exit code 0)

20. LLM CALL #4:
    LLM retorna texto: "Botão de dark mode adicionado ao Header. Testes passando."
    → sem tool calls → renderiza resposta final

21. HOOK POST-TASK: gera resumo e diff da tarefa
```
