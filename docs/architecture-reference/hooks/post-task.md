# Hook: post-task

## Evento
`post-task` — dispara ao finalizar uma tarefa completa.

## Ação
`run` — gera resumo da tarefa e diff das mudanças.

## Objetivo
Registrar o que foi feito, quais arquivos mudaram e qual o diff resultante. Isso cria um log auditável de cada tarefa.

## Implementação

```typescript
interface PostTaskHook {
  event: 'post-task';
  handler(context: {
    task: Task;
    workspacePath: string;
    session: SessionMemory;
  }): Promise<HookResult>;
}

async function postTaskHook(context: {
  task: Task;
  workspacePath: string;
  session: SessionMemory;
}): Promise<HookResult> {
  const { task, workspacePath, session } = context;

  // Verificar se Git está disponível (via doctor result ou tentativa)
  const hasGit = session.doctorResult?.checks.find(c => c.name === 'git')?.status === 'ok'
    ?? await isGitAvailable(workspacePath);

  let diff = '';
  let modifiedFiles: string[] = [];
  let addedFiles: string[] = [];

  if (hasGit) {
    // 1. Gerar diff de todas as mudanças
    diff = await shell('git diff');
    const stagedDiff = await shell('git diff --cached');
    const untrackedFiles = await shell('git ls-files --others --exclude-standard');

    // 2. Listar arquivos modificados
    modifiedFiles = (await shell('git diff --name-only')).split('\n').filter(Boolean);
    addedFiles = (await shell('git diff --cached --name-only --diff-filter=A')).split('\n').filter(Boolean);
  } else {
    // Fallback sem Git: usar file cache da sessão para determinar o que mudou
    modifiedFiles = session.fileCache
      ? Array.from(session.fileCache.entries.keys()).filter(p =>
          task.touchedFiles?.includes(p)
        )
      : task.touchedFiles ?? [];
    diff = '(Git não disponível — diff não gerado)';
  }

  // 3. Gerar resumo
  const summary = generateSummary(task, {
    modifiedFiles,
    addedFiles,
    diff,
    duration: Date.now() - task.startedAt,
    toolCalls: task.toolCallCount,
    autoCorrections: task.autoCorrections,
    hasGit,
  });

  // 5. Exibir ao usuário
  return {
    action: 'log',
    details: summary,
  };
}

function generateSummary(task: Task, data: TaskData): string {
  return [
    `## Resumo da Tarefa`,
    ``,
    `**Tarefa:** ${task.description}`,
    `**Modo:** ${task.mode}`,
    `**Duração:** ${formatDuration(data.duration)}`,
    `**Tool calls:** ${data.toolCalls}`,
    `**Autocorreções:** ${data.autoCorrections}`,
    ``,
    `### Arquivos Modificados`,
    ...data.modifiedFiles.map(f => `- \`${f}\``),
    ``,
    `### Arquivos Adicionados`,
    ...data.addedFiles.map(f => `- \`${f}\``),
    ``,
    `### Diff`,
    '```diff',
    data.diff.slice(0, 2000),  // truncar se muito longo
    data.diff.length > 2000 ? '\n... (truncado, use git diff para ver completo)' : '',
    '```',
  ].join('\n');
}
```

## Comportamento

### Ao finalizar tarefa:
```
────────────────────────────────────────
## Resumo da Tarefa

**Tarefa:** Adicionar dark mode ao header
**Modo:** ACT
**Duração:** 2m 34s
**Tool calls:** 12
**Autocorreções:** 1

### Arquivos Modificados
- `src/components/Header.tsx`
- `src/styles/theme.ts`

### Arquivos Adicionados
- `src/context/ThemeContext.tsx`

### Diff
  (diff resumido das mudanças)
────────────────────────────────────────
```

## Configuração

```json
{
  "post-task": {
    "showDiff": true,
    "saveToDisk": true,
    "maxDiffLines": 100,
    "historyDir": ".agent/history"
  }
}
```
