# Architecture — CLI Agent

## 1. Diagrama de Camadas

```
┌─────────────────────────────────────────────────────────┐
│                   TERMINAL UI LAYER                     │
│  Input Parser │ Renderer │ Spinner │ Panels │ Keybinds  │
├─────────────────────────────────────────────────────────┤
│                   COMMAND ROUTER                        │
│  Mode Router │ Slash Commands │ Skill Dispatcher        │
├─────────────────────────────────────────────────────────┤
│                    AGENT LOOP                           │
│  LLM Call │ Tool Selection │ Execution │ Retry Logic    │
├──────────┬──────────┬───────────┬───────────────────────┤
│  TOOLS   │  SKILLS  │ SUBAGENTS │       HOOKS           │
│ shell    │ repo-    │ security  │ pre-shell             │
│ fs       │ intel    │ arch-     │ post-edit             │
│ web      │ task-    │ review    │ post-task             │
│ git      │ planner  │ researcher│ pre-deploy            │
│ preview  │ ...      │ bug-inv.  │                       │
├──────────┴──────────┴───────────┴───────────────────────┤
│                 CONTEXT / MEMORY                        │
│  Session State │ Conversation │ File Cache │ Plan State │
├─────────────────────────────────────────────────────────┤
│                   MCP GATEWAY                           │
│  GitHub │ Docs │ DB │ CI/CD │ Issues │ Packages │ Logs  │
├─────────────────────────────────────────────────────────┤
│               SECURITY / PERMISSIONS                    │
│  Command Blocklist │ Workspace Sandbox │ MCP Trust      │
└─────────────────────────────────────────────────────────┘
```

## 2. Camadas Detalhadas

### 2.1 Terminal UI Layer

**Responsabilidade:** Toda interação visual com o usuário.

```
src/ui/
├── renderer.ts          # Engine de renderização ANSI
├── input.ts             # Captura e parsing de input do usuário
├── spinner.ts           # Animações de loading (ora/nanospinner)
├── panels.ts            # Painéis de diff, code, preview
├── syntax-highlight.ts  # Highlighting via shiki ou similar
├── keybinds.ts          # Atalhos de teclado
├── mode-indicator.ts    # Badge visual do modo atual
└── theme.ts             # Cores, ícones, espaçamento
```

**Regras:**
- A UI nunca executa lógica de negócio.
- A UI apenas renderiza dados recebidos do agent loop.
- Toda animação tem fallback para terminais sem suporte ANSI.

**Tecnologias recomendadas:**
- `ink` (React para terminal) ou `blessed`/`blessed-contrib` para layout.
- `chalk` para cores.
- `ora` ou `nanospinner` para spinners.
- `shiki` para syntax highlighting.
- `cli-highlight` como alternativa leve.

### 2.2 Command Router

**Responsabilidade:** Interpretar input do usuário e direcionar para o handler correto.

```typescript
interface CommandRouter {
  // Comandos slash
  handleSlash(command: string, args: string[]): void;

  // Mudança de modo
  switchMode(mode: 'CHAT' | 'PLAN' | 'ACT' | 'AUTO' | 'RESEARCH'): void;

  // Dispatch para skill específica
  dispatchSkill(skillName: string, context: TaskContext): Promise<SkillResult>;

  // Input livre vai para o agent loop
  handleFreeInput(text: string): void;
}
```

**Comandos slash padrão:**
- `/mode <modo>` — troca de modo.
- `/plan` — atalho para modo PLAN.
- `/act` — atalho para modo ACT.
- `/research <query>` — pesquisa direta.
- `/preview` — sobe preview do projeto.
- `/skill <nome>` — executa skill específica.
- `/status` — mostra estado atual do agent.
- `/undo` — desfaz última ação (se possível).
- `/help` — lista comandos disponíveis.

### 2.3 Agent Loop

**Responsabilidade:** Núcleo do agent. Recebe tarefa, chama LLM, seleciona ferramentas, executa, verifica resultado.

Detalhamento completo em `agent-loop.md`.

```
INPUT → CLASSIFY → [MODE GATE] → LLM CALL → TOOL SELECTION →
HOOK PRE → EXECUTE → HOOK POST → VERIFY → OUTPUT / RETRY
```

**Regras críticas:**
- Se o modo é PLAN, o loop **nunca** chega em EXECUTE para ações com side effects.
- Se o modo é CHAT, o loop **nunca** chega em TOOL SELECTION para ferramentas destrutivas.
- Se EXECUTE falha, o loop entra em RETRY com máximo configurável.
- Se RETRY esgota, o loop retorna erro estruturado ao usuário.

### 2.4 Tools (Ferramentas)

**Responsabilidade:** Executar ações atômicas no mundo real.

```typescript
interface Tool {
  name: string;
  description: string;
  availability: 'available' | 'unavailable' | 'dev-only';
  permissions: Permission[];
  execute(params: ToolParams): Promise<ToolResult>;
  validate(params: ToolParams): ValidationResult;
}
```

**Tools core:**

| Tool | Função | Permissão padrão |
|---|---|---|
| `shell` | Executa comando no terminal | ask (comandos destrutivos: deny) |
| `fs_read` | Lê arquivo do disco | allow |
| `fs_write` | Escreve/edita arquivo | ask |
| `fs_glob` | Busca arquivos por pattern | allow |
| `fs_grep` | Busca conteúdo em arquivos | allow |
| `web_search` | Pesquisa na web | allow |
| `web_fetch` | Busca conteúdo de URL | allow |
| `git` | Operações git | ask |
| `preview` | Sobe servidor de preview | ask |

**Classificação de disponibilidade:**
```typescript
function classifyToolAvailability(tool: Tool): ToolAvailability {
  // Tool existe e está funcional
  if (tool.isInstalled && tool.hasAccess) return 'available';

  // Tool existe mas não tem acesso (ex: sem API key)
  if (tool.isInstalled && !tool.hasAccess) return 'unavailable';

  // Tool só funciona em dev (ex: mock server)
  if (tool.isDevOnly) return 'dev-only';

  return 'unavailable';
}
```

### 2.5 Skills

**Responsabilidade:** Workflows reutilizáveis compostos de múltiplas tool calls.

```typescript
interface Skill {
  name: string;
  description: string;
  trigger: SkillTrigger;          // quando ativar
  requiredTools: string[];         // tools que precisa
  execute(context: TaskContext): Promise<SkillResult>;
}

interface SkillTrigger {
  manual: boolean;                 // invocável por /skill <nome>
  auto: boolean;                   // detectável automaticamente
  patterns: string[];              // patterns de ativação automática
}
```

**Diferença de tools:** Skills são composições. Uma skill pode chamar 5 tools em sequência, com lógica de decisão entre elas.

### 2.6 Subagents

**Responsabilidade:** Especialistas com contexto e prompt próprios.

```typescript
interface Subagent {
  name: string;
  specialty: string;
  systemPrompt: string;           // prompt próprio do especialista
  tools: string[];                 // tools disponíveis para este subagent
  permissions: Permission[];       // permissões próprias (geralmente mais restritas)
  maxTokens: number;               // limite de contexto
  execute(task: SubagentTask): Promise<SubagentResult>;
}
```

**Diferença de skills:** Subagents têm contexto isolado. Eles recebem uma tarefa, processam com seu próprio prompt e contexto, e retornam resultado estruturado. Não poluem o contexto do agent principal.

### 2.7 Hooks

**Responsabilidade:** Automações determinísticas que disparam em momentos específicos.

```typescript
interface Hook {
  name: string;
  event: HookEvent;
  action: 'block' | 'warn' | 'run' | 'log';
  handler(context: HookContext): Promise<HookResult>;
}

// Referência canônica: specs/contracts.md seção 2
type HookEvent =
  | 'pre-shell'          // antes de executar comando shell
  | 'pre-write'          // antes de escrever/criar arquivo (workspace sandbox)
  | 'post-edit'          // depois de editar arquivo existente
  | 'post-task'          // ao finalizar tarefa
  | 'pre-deploy'         // antes de deploy
  | 'pre-git-push'       // antes de git push
  | 'on-error'           // quando ocorre erro
  | 'on-session-start';  // início de sessão (doctor/healthcheck)
```

**Diferença de skills:** Hooks são determinísticos. Não envolvem LLM. São regras fixas que sempre executam da mesma forma.

> **Nota:** A lista completa de hook events, actions e mapeamentos está em `specs/contracts.md` seção 2. Em caso de divergência, o contracts.md é a fonte de verdade.

### 2.8 Context / Memory

**Responsabilidade:** Gerenciar estado da sessão, conversação e cache.

Detalhamento completo em `memory.md`.

```
MEMORY
├── session_state      # modo atual, tarefa ativa, plano em andamento
├── conversation       # histórico de mensagens (com compressão)
├── file_cache         # cache de arquivos lidos (invalidado por mtime)
├── plan_state         # plano atual, passos concluídos, próximo passo
├── tool_results       # resultados recentes de tools (para retry/referência)
└── project_context    # stack detectada, estrutura, conventions
```

### 2.9 MCP Gateway

**Responsabilidade:** Interface padronizada para serviços externos.

```typescript
interface MCPConnection {
  server: string;
  trust: 'trusted' | 'untrusted' | 'verified';
  permissions: MCPPermission[];
  tools: MCPTool[];
  healthCheck(): Promise<boolean>;
}
```

Detalhamento completo em `mcp.md`.

### 2.10 Security / Permissions

**Responsabilidade:** Garantir que nenhuma ação perigosa execute sem aprovação.

```typescript
type PermissionLevel = 'allow' | 'ask' | 'deny';

interface PermissionRule {
  tool: string;
  action: string;
  pattern?: RegExp;           // ex: /rm\s+-rf/ para shell
  level: PermissionLevel;
  reason: string;
}
```

**Blocklist de comandos (padrão):**
```typescript
const BLOCKED_COMMANDS = [
  /rm\s+-rf\s+\//,            // rm -rf /
  /rm\s+-rf\s+~/,             // rm -rf ~
  /del\s+\/f\s+\/q/i,         // del /f /q (Windows)
  /mkfs\./,                    // mkfs.*
  /dd\s+if=.*of=\/dev/,       // dd para devices
  /:(){ :\|:& };:/,           // fork bomb
  /chmod\s+-R\s+777\s+\//,    // chmod 777 /
  />\s*\/dev\/sda/,            // write to raw device
];
```

**Workspace sandbox:**
- Todas as operações de filesystem são restritas ao diretório do projeto.
- Tentativa de escrever fora do workspace → bloqueio + aviso.
- Symlinks que apontam para fora do workspace → bloqueio.

## 3. Fluxo de Dados

```
Usuário digita input
    │
    ▼
[Terminal UI] captura texto
    │
    ▼
[Command Router] classifica:
    ├── Comando slash → handler específico
    ├── Mudança de modo → atualiza session_state
    └── Input livre → agent loop
         │
         ▼
    [Agent Loop] processa:
         │
         ├── Consulta mode gate (CHAT? PLAN? ACT?)
         ├── Chama LLM com contexto
         ├── LLM retorna tool calls
         │
         ▼
    [Hook: pre-*] executa verificações
         │
         ├── BLOCK → aborta, notifica usuário
         └── PASS → continua
              │
              ▼
         [Tool/Skill/Subagent] executa ação real
              │
              ▼
         [Hook: post-*] executa verificações
              │
              ▼
         [Agent Loop] verifica resultado:
              ├── Sucesso → renderiza output
              ├── Erro → retry (até max)
              └── Erro fatal → reporta ao usuário
```

## 4. Estrutura de Diretórios do Projeto

```
cli-agent/
├── src/
│   ├── index.ts                 # Entry point
│   ├── agent/
│   │   ├── loop.ts              # Agent loop principal
│   │   ├── modes.ts             # Lógica de modos (CHAT/PLAN/ACT/AUTO/RESEARCH)
│   │   ├── retry.ts             # Lógica de retry e autocorreção
│   │   └── classifier.ts        # Classificador de intenção
│   ├── ui/
│   │   ├── renderer.ts
│   │   ├── input.ts
│   │   ├── spinner.ts
│   │   ├── panels.ts
│   │   ├── diff-view.ts
│   │   ├── preview-panel.ts
│   │   ├── mode-indicator.ts
│   │   └── theme.ts
│   ├── tools/
│   │   ├── registry.ts          # Registro e discovery de tools
│   │   ├── shell.ts
│   │   ├── filesystem.ts
│   │   ├── web-search.ts
│   │   ├── web-fetch.ts
│   │   ├── git.ts
│   │   └── preview.ts
│   ├── skills/
│   │   ├── loader.ts            # Carrega skills de arquivos
│   │   ├── dispatcher.ts        # Seleciona e executa skills
│   │   └── definitions/         # Arquivos de definição de skills
│   ├── subagents/
│   │   ├── runner.ts            # Executa subagents isolados
│   │   └── definitions/         # Definições de subagents
│   ├── hooks/
│   │   ├── engine.ts            # Motor de hooks
│   │   └── rules/               # Regras de hooks
│   ├── memory/
│   │   ├── session.ts
│   │   ├── conversation.ts
│   │   ├── file-cache.ts
│   │   └── plan-state.ts
│   ├── mcp/
│   │   ├── gateway.ts
│   │   ├── trust.ts
│   │   └── connections/
│   └── security/
│       ├── permissions.ts
│       ├── blocklist.ts
│       └── sandbox.ts
├── skills/                       # Definições de skills (markdown + config)
├── subagents/                    # Definições de subagents
├── hooks/                        # Configuração de hooks
├── specs/                        # Documentação de specs
├── prompts/                      # Prompts base do sistema
├── AGENTS.md                     # Convenções obrigatórias
├── package.json
└── tsconfig.json
```

## 5. Tecnologias Recomendadas

| Componente | Tecnologia | Justificativa |
|---|---|---|
| Runtime | Node.js 20+ ou Bun | Ecossistema CLI maduro |
| Linguagem | TypeScript strict | Type safety para agent crítico |
| UI terminal | ink 4+ | React model para terminal, composable |
| Cores | chalk 5+ | API limpa, suporte amplo |
| Spinner | ora / nanospinner | Leve, customizável |
| Syntax highlight | shiki | Mesmo engine do VS Code |
| Shell execution | execa | Melhor que child_process nativo |
| Git | simple-git | Wrapper tipado para git CLI |
| LLM client | Anthropic SDK / OpenAI SDK | Depende do provider |
| MCP | @modelcontextprotocol/sdk | Padrão oficial |
| Config | cosmiconfig | Padrão de config para CLIs Node |
| Args parsing | yargs / commander | Maduro, bem documentado |
