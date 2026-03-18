# Memory — Especificação (v1)

## 1. Visão Geral

O sistema de memória gerencia todo o estado que o agent precisa para operar de forma coerente durante uma sessão.

**Princípio:** Memória não é simulada. Toda informação armazenada vem de ações reais, leituras reais ou resultados reais de ferramentas.

### Escopo da v1

A v1 foca em memória **de sessão** e **de projeto (convenções + cache)**. Memória global sofisticada (preferências cross-projeto, fatos aprendidos com confiança, file importance maps) fica para a v2.

```
┌──────────────────────────── v1 ──────────────────────────────┐
│                                                              │
│  ┌─────────────────────────────────────────┐                 │
│  │           MEMÓRIA IMEDIATA              │                 │
│  │  Contexto da chamada LLM atual          │                 │
│  │  - system prompt                        │                 │
│  │  - mensagens recentes                   │                 │
│  │  - tool results pendentes               │                 │
│  │  Duração: uma iteração do loop          │                 │
│  ├─────────────────────────────────────────┤                 │
│  │           MEMÓRIA DE SESSÃO             │                 │
│  │  Estado persistente durante a sessão    │                 │
│  │  - modo atual                           │                 │
│  │  - plano ativo                          │                 │
│  │  - histórico de conversa (curto)        │                 │
│  │  - cache de arquivos (leve)             │                 │
│  │  - project context                      │                 │
│  │  - doctor result (healthcheck)          │                 │
│  │  - approval memory (aprovações ativas)  │                 │
│  │  Duração: uma sessão do agent           │                 │
│  ├─────────────────────────────────────────┤                 │
│  │     MEMÓRIA DE PROJETO (leve)           │                 │
│  │  Persistida em disco no workspace       │                 │
│  │  - .agent/conventions.json              │                 │
│  │  - .agent/cache/repo-intel.json         │                 │
│  │  Duração: vida do projeto               │                 │
│  └─────────────────────────────────────────┘                 │
│                                                              │
├──────────────────────────── v2 (futuro) ─────────────────────┤
│                                                              │
│  - Memória global (~/.config/cli-agent/)                     │
│  - Fatos aprendidos com score de confiança                   │
│  - Histórico de sessões por data                             │
│  - File importance maps                                      │
│  - Preferências cross-projeto                                │
│  - Trusted MCPs persistidos                                  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## 2. Memória Imediata

Montada a cada iteração do agent loop. É o contexto enviado ao LLM.

```typescript
interface ImmediateMemory {
  systemPrompt: string;
  messages: Message[];
  pendingToolResults: ToolResult[];
  availableTools: ToolDefinition[];
}
```

### Compressão de contexto

Quando o contexto se aproxima do limite de tokens:

```typescript
interface CompressionStrategy {
  // 1. Remove tool results antigos (mantém os 5 mais recentes)
  pruneOldToolResults(results: ToolResult[], keep: number): ToolResult[];

  // 2. Sumariza mensagens antigas
  summarizeOldMessages(messages: Message[], threshold: number): Message[];

  // 3. Remove file contents do cache (mantém paths)
  compressFileCache(cache: FileCache): FileCache;

  // 4. Último recurso: trunca conversa para N mensagens mais recentes
  truncateConversation(messages: Message[], keep: number): Message[];
}

const COMPRESSION_THRESHOLDS = {
  toolResultPrune: 0.7,       // 70% do limite → comprime tool results
  messageSummarize: 0.8,      // 80% → sumariza mensagens antigas
  fileCacheCompress: 0.9,     // 90% → comprime file cache
  conversationTruncate: 0.95, // 95% → trunca conversa
};
```

## 3. Memória de Sessão

Persiste durante toda a sessão do agent (enquanto o processo está rodando).

```typescript
interface SessionMemory {
  // Estado operacional
  mode: Mode;                    // modo atual (CHAT, PLAN, ACT, AUTO, RESEARCH)
  taskStack: Task[];             // pilha de tarefas (suporta subtarefas)

  // Plano ativo
  activePlan: Plan | null;

  // Conversa (curta — comprimida agressivamente)
  conversation: ConversationStore;

  // Cache (leve — invalidação proativa)
  fileCache: FileCache;

  // Projeto
  projectContext: ProjectContext | null;

  // Doctor (preenchido no on-session-start)
  doctorResult: DoctorResult | null;

  // Aprovações ativas (ver prompts/approval-flow.md)
  approvalMemory: ApprovalMemory;
}
```

### Conversation Store

```typescript
interface ConversationStore {
  messages: Message[];
  totalTokens: number;

  add(message: Message): void;
  getRecent(n: number): Message[];
  compress(): void;            // sumariza mensagens antigas
}

interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  metadata: {
    mode: Mode;
    toolCalls?: ToolCall[];
    tokenCount: number;
  };
}
```

### File Cache

```typescript
interface FileCache {
  entries: Map<string, FileCacheEntry>;

  get(path: string): FileCacheEntry | null;
  set(path: string, content: string, mtime: number): void;
  invalidate(path: string): void;
  invalidateAll(): void;
}

interface FileCacheEntry {
  path: string;
  content: string;
  mtime: number;          // modification time — para invalidação
  readAt: number;         // quando foi lido
  tokenCount: number;     // tokens consumidos
}
```

**Regras de invalidação:**
- Antes de usar cache, verifica se `mtime` do arquivo mudou.
- Se o agent editou o arquivo, invalida o cache imediatamente.
- Se um hook (formatter/lint) modificou o arquivo, invalida.
- Cache não sobrevive entre sessões.

### Plan State

```typescript
interface Plan {
  id: string;
  objective: string;
  steps: PlanStep[];
  affectedFiles: string[];
  risks: string[];
  status: 'draft' | 'approved' | 'in_progress' | 'completed' | 'failed';
  createdAt: number;
  completedAt: number | null;
}

interface PlanStep {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed';
  toolsNeeded: string[];
  output: string | null;
  error: string | null;
}
```

## 4. Memória de Projeto (v1 — leve)

Na v1, a memória de projeto é mínima: apenas convenções detectadas e cache do repo-intel.

```
.agent/
├── conventions.json     # Convenções detectadas/configuradas
└── cache/
    └── repo-intel.json  # Cache do repo-intel (stack, estrutura)
```

### conventions.json

```json
{
  "codeStyle": {
    "formatter": "prettier",
    "linter": "eslint",
    "indentation": "spaces-2",
    "quotes": "single",
    "semicolons": false
  },
  "gitConventions": {
    "branchPattern": "feat|fix|chore|docs/<description>",
    "commitPattern": "conventional-commits",
    "prTemplate": true
  },
  "architecture": {
    "pattern": "feature-based",
    "stateManagement": "zustand",
    "testFramework": "vitest",
    "componentPattern": "functional + hooks"
  },
  "rules": [
    "Nunca usar any em TypeScript",
    "Testes obrigatórios para utils/",
    "Componentes devem ter prop types explícitos"
  ]
}
```

**O que NÃO está na v1:**
- `memory.json` com lastSession, learnedFacts, fileImportanceMap → v2
- `history/` com logs de sessão por data → v2
- `preferences.json` global → v2
- `trusted-mcps.json` global → v2
- `permissions.json` global → v2

## 5. Fluxo de Memória no Agent Loop

```
INÍCIO DA SESSÃO
    │
    ├── Carrega memória de projeto (.agent/conventions.json)
    ├── Carrega cache do repo-intel (.agent/cache/)
    ├── Inicializa memória de sessão (vazia)
    └── Roda doctor/healthcheck → salva em sessionMemory.doctorResult
         │
         ▼
CADA ITERAÇÃO DO LOOP
    │
    ├── Monta memória imediata:
    │   ├── System prompt (baseado no modo + doctor result)
    │   ├── Conversation (com compressão se necessário)
    │   ├── Project context (do cache ou repo-intel)
    │   ├── Tool results recentes
    │   └── Available tools (filtrados pelo modo + doctor)
    │
    ├── Após execução:
    │   ├── Atualiza conversation com resposta
    │   ├── Atualiza file cache se leu/editou arquivo
    │   ├── Atualiza plan state se está em modo PLAN/AUTO
    │   └── Atualiza approval memory se houve aprovação
    │
    └── Periodicamente:
        └── Atualiza .agent/conventions.json se detectou algo novo
             │
             ▼
FIM DA SESSÃO
    │
    ├── Atualiza .agent/conventions.json (se mudou)
    └── Limpa memória de sessão
```

## 6. Limites e Proteções

```typescript
const MEMORY_LIMITS = {
  // Memória imediata
  maxContextTokens: 128_000,      // depende do modelo
  maxToolResults: 20,              // resultados mantidos no contexto
  maxFilesCached: 30,              // arquivos no cache (reduzido para v1)

  // Memória de sessão
  maxConversationMessages: 200,    // mensagens antes de forçar compressão (reduzido)
  maxSessionDuration: 4 * 3600,    // 4 horas (conservador na v1)

  // Memória de projeto
  maxConventionsFileSize: 102_400, // 100KB para conventions.json
  maxCacheSize: 524_288,           // 512KB para cache total
};
```

## 7. Estratégia de Recuperação

Se a memória de sessão corrompe (crash, OOM):

```typescript
async function recoverSession(): Promise<SessionMemory> {
  // Na v1, não há checkpoint. Simplesmente reinicia limpo.
  // O conventions.json e repo-intel cache sobrevivem (estão em disco).
  console.log('Reiniciando sessão limpa. Convenções e cache do projeto preservados.');
  return createFreshSession();
}
```

## 8. Privacidade e Segurança

- `.agent/` deve ser adicionado ao `.gitignore` por padrão.
- Nunca armazena tokens, senhas, API keys na memória.
- Se detecta conteúdo sensível, substitui por placeholder: `[REDACTED]`.
- Ao desinstalar o agent, `rm -rf .agent/` limpa tudo do projeto.

## 9. Evolução para v2

Quando a v1 estiver estável, as seguintes features podem ser adicionadas:

| Feature | Justificativa | Risco |
|---|---|---|
| Memória global | Preferências cross-projeto | Privacidade, sincronização |
| Fatos aprendidos | Agent "lembra" coisas sobre o projeto | Contexto errado, viés |
| Histórico de sessões | Continuidade entre sessões | Tamanho, relevância |
| File importance map | Priorizar arquivos importantes | Manutenção, stale data |
| Trusted MCPs | Não pedir aprovação de MCPs conhecidos | Segurança |

**Regra para adicionar feature de memória:** só entra quando há evidência real de que usuários precisam e quando o mecanismo de invalidação/limpeza está pronto.
