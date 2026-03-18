# Contracts — Fonte Única de Verdade

Este arquivo é a **referência canônica** para nomes, enums, permissões e eventos do CLI Agent. Toda documentação, código e configuração DEVE derivar deste arquivo. Se houver conflito entre qualquer outro arquivo e este, **este arquivo vence**.

## 1. Modos Operacionais

```typescript
enum Mode {
  CHAT     = 'CHAT',
  PLAN     = 'PLAN',
  ACT      = 'ACT',
  AUTO     = 'AUTO',
  RESEARCH = 'RESEARCH',
}
```

### Transições Válidas

```typescript
const VALID_TRANSITIONS: Record<Mode, Mode[]> = {
  CHAT:     [Mode.PLAN, Mode.ACT, Mode.RESEARCH, Mode.AUTO],
  PLAN:     [Mode.CHAT, Mode.ACT, Mode.RESEARCH],     // ACT requer plano aprovado
  ACT:      [Mode.CHAT, Mode.PLAN, Mode.RESEARCH, Mode.AUTO],
  AUTO:     [Mode.CHAT, Mode.PLAN],                     // AUTO para em CHAT ou PLAN
  RESEARCH: [Mode.CHAT, Mode.PLAN, Mode.ACT],
};

const TRANSITION_GUARDS: Partial<Record<string, TransitionGuard>> = {
  'PLAN→ACT':  { requires: 'approved_plan' },
  '*→AUTO':    { requires: 'user_confirmation' },
};
```

## 2. Hook Events

```typescript
enum HookEvent {
  PRE_SHELL     = 'pre-shell',       // antes de executar comando shell
  PRE_WRITE     = 'pre-write',       // antes de escrever/criar arquivo
  POST_EDIT     = 'post-edit',       // depois de editar arquivo existente
  POST_TASK     = 'post-task',       // ao finalizar tarefa
  PRE_DEPLOY    = 'pre-deploy',      // antes de deploy
  PRE_GIT_PUSH  = 'pre-git-push',   // antes de git push
  ON_ERROR      = 'on-error',        // quando ocorre erro
  ON_SESSION_START = 'on-session-start', // início de sessão (doctor/healthcheck)
}
```

### Hook Actions

```typescript
enum HookAction {
  ALLOW = 'allow',     // permite a ação silenciosamente
  BLOCK = 'block',     // bloqueia a ação, não prossegue
  WARN  = 'warn',      // alerta e pede confirmação
  RUN   = 'run',       // executa automação (formatter, lint, resumo)
  LOG   = 'log',       // apenas registra, não interfere
}
```

### Mapeamento Hook → Action Padrão

| Hook Event | Action Padrão | Arquivo de Definição |
|---|---|---|
| `pre-shell` | `block` / `warn` | `hooks/pre-shell.md` |
| `pre-write` | `block` (fora do workspace) | `hooks/workspace-sandbox.md` |
| `post-edit` | `run` (formatter/lint) | `hooks/post-edit.md` |
| `post-task` | `run` (resumo/diff) | `hooks/post-task.md` |
| `pre-deploy` | `block` (sem checklist) | `hooks/pre-deploy.md` |
| `pre-git-push` | `warn` | (configurável) |
| `on-error` | `log` | (configurável) |
| `on-session-start` | `run` (doctor) | `hooks/on-session-start.md` |

## 3. Skills — Nomes Canônicos

```typescript
enum SkillName {
  REPO_INTEL              = 'repo-intel',
  TASK_PLANNER            = 'task-planner',
  IMPLEMENT_MINIMAL_DIFF  = 'implement-minimal-diff',
  TEST_LINT_FIX           = 'test-lint-fix',
  CURRENT_DOCS            = 'current-docs',
  GIT_PR_HELPER           = 'git-pr-helper',
  SECURITY_REVIEW         = 'security-review',
  DEPENDENCY_RESEARCH     = 'dependency-research',
  RELEASE_DEPLOY_CHECKLIST = 'release-deploy-checklist',
  PROJECT_CONVENTIONS     = 'project-conventions',
  DOCS_WRITER             = 'docs-writer',
}
```

**Nota:** `bug-investigator` foi removido da lista de skills. Investigação de bugs é responsabilidade exclusiva do **subagent** `bug-investigator`, que tem contexto próprio e prompt especializado. Ver seção 4.

## 4. Subagents — Nomes Canônicos

```typescript
enum SubagentName {
  SECURITY_REVIEWER      = 'security-reviewer',
  ARCHITECTURE_REVIEWER  = 'architecture-reviewer',
  RESEARCHER             = 'researcher',
  BUG_INVESTIGATOR       = 'bug-investigator',
}
```

### Namespacing: Skill vs Subagent

Para evitar colisão de nomes:
- Skills são invocadas com: `/skill <nome>`
- Subagents são invocados com: `/subagent <nome>` ou delegados automaticamente pelo agent loop
- **Regra:** nenhum nome pode existir simultaneamente em `SkillName` e `SubagentName`
- Se um workflow existe como subagent, ele **não existe** como skill (e vice-versa)

### Tabela de Resolução

| Workflow | Tipo | Justificativa |
|---|---|---|
| `bug-investigator` | **subagent** | Requer contexto profundo, hipóteses iterativas, raciocínio isolado |
| `security-review` | **skill** | Verificação rápida com padrões conhecidos (grep + audit) |
| `security-reviewer` | **subagent** | Análise profunda quando skill detecta necessidade |

## 5. Classes de Permissão

```typescript
enum PermissionClass {
  READ          = 'read',           // ler arquivos, glob, grep
  WRITE_LOCAL   = 'write-local',    // editar/criar arquivos no workspace
  SHELL_SAFE    = 'shell-safe',     // comandos não-destrutivos (ls, cat, npm test)
  SHELL_UNSAFE  = 'shell-unsafe',   // comandos potencialmente destrutivos
  GIT_LOCAL     = 'git-local',      // git add, commit, branch, log, diff
  GIT_REMOTE    = 'git-remote',     // git push, pull, fetch
  NETWORK       = 'network',        // web_search, web_fetch, MCP calls
  INSTALL       = 'install',        // npm install, pip install
  PREVIEW       = 'preview',        // subir servidor de preview
  DEPLOY        = 'deploy',         // deploy para qualquer ambiente
  PUBLISH       = 'publish',        // npm publish, docker push
  DB_WRITE      = 'db-write',       // escrita em banco de dados
}
```

### Matriz Modo × Classe de Permissão

```typescript
const MODE_PERMISSION_MATRIX: Record<Mode, Record<PermissionClass, PermissionLevel>> = {
  CHAT: {
    [PermissionClass.READ]:          'allow',
    [PermissionClass.WRITE_LOCAL]:   'deny',
    [PermissionClass.SHELL_SAFE]:    'deny',
    [PermissionClass.SHELL_UNSAFE]:  'deny',
    [PermissionClass.GIT_LOCAL]:     'deny',
    [PermissionClass.GIT_REMOTE]:    'deny',
    [PermissionClass.NETWORK]:       'deny',
    [PermissionClass.INSTALL]:       'deny',
    [PermissionClass.PREVIEW]:       'deny',
    [PermissionClass.DEPLOY]:        'deny',
    [PermissionClass.PUBLISH]:       'deny',
    [PermissionClass.DB_WRITE]:      'deny',
  },

  PLAN: {
    [PermissionClass.READ]:          'allow',
    [PermissionClass.WRITE_LOCAL]:   'deny',
    [PermissionClass.SHELL_SAFE]:    'deny',
    [PermissionClass.SHELL_UNSAFE]:  'deny',
    [PermissionClass.GIT_LOCAL]:     'deny',
    [PermissionClass.GIT_REMOTE]:    'deny',
    [PermissionClass.NETWORK]:       'allow',   // pode pesquisar para planejar
    [PermissionClass.INSTALL]:       'deny',
    [PermissionClass.PREVIEW]:       'deny',
    [PermissionClass.DEPLOY]:        'deny',
    [PermissionClass.PUBLISH]:       'deny',
    [PermissionClass.DB_WRITE]:      'deny',
  },

  ACT: {
    [PermissionClass.READ]:          'allow',
    [PermissionClass.WRITE_LOCAL]:   'ask',
    [PermissionClass.SHELL_SAFE]:    'ask',
    [PermissionClass.SHELL_UNSAFE]:  'ask',
    [PermissionClass.GIT_LOCAL]:     'ask',
    [PermissionClass.GIT_REMOTE]:    'ask',
    [PermissionClass.NETWORK]:       'allow',
    [PermissionClass.INSTALL]:       'ask',
    [PermissionClass.PREVIEW]:       'ask',
    [PermissionClass.DEPLOY]:        'ask',
    [PermissionClass.PUBLISH]:       'ask',
    [PermissionClass.DB_WRITE]:      'ask',
  },

  AUTO: {
    [PermissionClass.READ]:          'allow',
    [PermissionClass.WRITE_LOCAL]:   'allow',   // liberado após aprovação inicial
    [PermissionClass.SHELL_SAFE]:    'allow',   // liberado
    [PermissionClass.SHELL_UNSAFE]:  'ask',     // SEMPRE pede, mesmo em AUTO
    [PermissionClass.GIT_LOCAL]:     'allow',   // liberado
    [PermissionClass.GIT_REMOTE]:    'ask',     // push sempre pede
    [PermissionClass.NETWORK]:       'allow',   // liberado
    [PermissionClass.INSTALL]:       'ask',     // instalar deps sempre pede
    [PermissionClass.PREVIEW]:       'allow',   // liberado
    [PermissionClass.DEPLOY]:        'deny',    // NUNCA em AUTO
    [PermissionClass.PUBLISH]:       'deny',    // NUNCA em AUTO
    [PermissionClass.DB_WRITE]:      'deny',    // NUNCA em AUTO
  },

  RESEARCH: {
    [PermissionClass.READ]:          'allow',
    [PermissionClass.WRITE_LOCAL]:   'deny',
    [PermissionClass.SHELL_SAFE]:    'deny',
    [PermissionClass.SHELL_UNSAFE]:  'deny',
    [PermissionClass.GIT_LOCAL]:     'deny',
    [PermissionClass.GIT_REMOTE]:    'deny',
    [PermissionClass.NETWORK]:       'allow',
    [PermissionClass.INSTALL]:       'deny',
    [PermissionClass.PREVIEW]:       'deny',
    [PermissionClass.DEPLOY]:        'deny',
    [PermissionClass.PUBLISH]:       'deny',
    [PermissionClass.DB_WRITE]:      'deny',
  },
};
```

### Regras do AUTO (detalhamento)

A aprovação inicial do modo AUTO **não** é um cheque em branco. Ela libera:
- leitura de arquivos
- escrita local no workspace
- shell seguro (npm test, npx tsc, etc.)
- git local (add, commit, branch)
- pesquisa web/MCP
- preview

A aprovação inicial **não** libera:
- shell inseguro (comandos na warn list)
- git remote (push, force push)
- instalação de dependências
- deploy
- publicação
- escrita em banco

Essas ações **sempre** pedem confirmação individual, independente do modo.

## 6. Tools — Mapeamento para Classes de Permissão

```typescript
const TOOL_PERMISSION_MAP: Record<string, PermissionClass> = {
  'fs_read':      PermissionClass.READ,
  'fs_glob':      PermissionClass.READ,
  'fs_grep':      PermissionClass.READ,
  'fs_write':     PermissionClass.WRITE_LOCAL,
  'fs_create':    PermissionClass.WRITE_LOCAL,
  'shell':        PermissionClass.SHELL_SAFE,     // default; reclassifica se na warn/block list
  'git_add':      PermissionClass.GIT_LOCAL,
  'git_commit':   PermissionClass.GIT_LOCAL,
  'git_branch':   PermissionClass.GIT_LOCAL,
  'git_log':      PermissionClass.READ,
  'git_diff':     PermissionClass.READ,
  'git_push':     PermissionClass.GIT_REMOTE,
  'git_pull':     PermissionClass.GIT_REMOTE,
  'web_search':   PermissionClass.NETWORK,
  'web_fetch':    PermissionClass.NETWORK,
  'preview':      PermissionClass.PREVIEW,
  'npm_install':  PermissionClass.INSTALL,
  'deploy':       PermissionClass.DEPLOY,
  'npm_publish':  PermissionClass.PUBLISH,
};
```

## 7. Tool Availability

```typescript
enum ToolAvailability {
  AVAILABLE   = 'available',     // instalada e funcional
  UNAVAILABLE = 'unavailable',   // não disponível
  DEV_ONLY    = 'dev-only',      // apenas em ambiente de desenvolvimento
}
```

## 8. Ordem de Workflows Pós-Implementação

Esta é a ordem **canônica**. Todos os docs devem referenciar esta ordem:

```typescript
const POST_IMPLEMENTATION_ORDER = [
  SkillName.TEST_LINT_FIX,           // 1. Testes, lint e typecheck
  SkillName.SECURITY_REVIEW,         // 2. Review de segurança (skill rápida)
  // Se security-review detecta problema grave → delega para subagent security-reviewer
  SkillName.GIT_PR_HELPER,           // 3. Branch, commit, PR
] as const;
```

## 9. Ordem de Workflows Pré-Implementação

```typescript
const PRE_IMPLEMENTATION_ORDER = [
  SkillName.REPO_INTEL,              // 1. Se project context vazio
  SkillName.CURRENT_DOCS,            // 2. Se tarefa envolve API/SDK/framework externo (BLOQUEANTE)
  SkillName.TASK_PLANNER,            // 3. Gerar plano antes de editar
] as const;
```

## 10. Approval Contract

Toda aprovação no terminal DEVE seguir este formato:

```typescript
interface ApprovalRequest {
  action: string;                    // ex: "Executar comando shell"
  detail: string;                    // ex: "npm install react@19"
  filesAffected: string[];           // ex: ["package.json", "package-lock.json"]
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  permissionClass: PermissionClass;
  scope: ApprovalScope;
}

enum ApprovalScope {
  ONCE         = 'once',             // apenas esta vez
  THIS_TASK    = 'this-task',        // para esta tarefa inteira
  THIS_SESSION = 'this-session',     // para esta sessão
  ALWAYS       = 'always',           // permanente (salvo em config)
}
```

### Renderização Visual

```
┌─ APROVAÇÃO ──────────────────────────────────────────┐
│                                                      │
│  Ação: Instalar dependência                          │
│  Comando: npm install react@19 react-dom@19          │
│  Arquivos: package.json, package-lock.json           │
│  Risco: ■■□□ médio                                   │
│  Classe: install                                     │
│                                                      │
│  [1] Aprovar uma vez                                 │
│  [2] Aprovar nesta tarefa                            │
│  [3] Aprovar nesta sessão                            │
│  [n] Negar                                           │
│                                                      │
└──────────────────────────────────────────────────────┘
```

## 11. Doctor/Healthcheck — Resultado Esperado

```typescript
interface DoctorResult {
  checks: {
    name: string;
    status: 'ok' | 'warning' | 'error' | 'unavailable';
    detail: string;
    fix?: string;                    // sugestão de correção
  }[];
  overallStatus: 'healthy' | 'degraded' | 'broken';
}
```

Checks obrigatórios:
| Check | O que verifica |
|---|---|
| `shell` | Shell disponível e funcional |
| `git` | Git instalado e workspace é repositório (ou não) |
| `node` | Node.js instalado e versão |
| `package-manager` | npm/pnpm/yarn detectado via lockfile |
| `web-search` | Tool de pesquisa web disponível |
| `web-fetch` | Tool de fetch disponível |
| `formatter` | Prettier/Black/gofmt detectado e funcional |
| `linter` | ESLint/Pylint/Clippy detectado e funcional |
| `test-runner` | Framework de teste detectado |
| `mcp-*` | Cada MCP configurado: conectividade e healthcheck |
| `preview` | Dev server detectável no projeto |
| `platform` | SO, shell type, encoding |

## 12. Platform / Environment

```typescript
interface PlatformInfo {
  os: 'linux' | 'macos' | 'windows';
  shell: 'bash' | 'zsh' | 'fish' | 'powershell' | 'cmd' | 'unknown';
  isWSL: boolean;
  hasGit: boolean;
  nodeVersion: string | null;
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | null;
  encoding: string;
}
```

### Regras Cross-Platform

| Aspecto | Unix (bash/zsh) | PowerShell | CMD | WSL |
|---|---|---|---|---|
| Separador de path | `/` | `\` (aceita `/`) | `\` | `/` |
| Kill processo | `kill -SIGTERM` | `Stop-Process` | `taskkill /F` | `kill -SIGTERM` |
| Variáveis de env | `export VAR=val` | `$env:VAR="val"` | `set VAR=val` | `export VAR=val` |
| Limpar terminal | `clear` | `Clear-Host` | `cls` | `clear` |
| Blocklist extra | — | `Remove-Item -Recurse -Force` | `rd /s /q` | — |

## 13. Versionamento deste Contrato

```
Versão: 1.1.0
Última atualização: 2026-03-13
Changelog:
  1.1.0 - Classes de permissão, approval contract, doctor, cross-platform
  1.0.0 - Versão inicial com enums, hooks, skills, subagents
```

**Regra:** Ao alterar qualquer enum, nome ou contrato neste arquivo, buscar e atualizar TODOS os arquivos que referenciam o valor alterado.
