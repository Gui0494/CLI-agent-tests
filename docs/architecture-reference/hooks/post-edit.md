# Hook: post-edit

## Evento
`post-edit` — dispara após qualquer edição de arquivo.

## Ação
`run` — executa formatter e lint automaticamente no arquivo editado.

## Objetivo
Garantir que todo arquivo editado pelo agent esteja formatado e sem erros de lint imediatamente após edição.

## Implementação

```typescript
interface PostEditHook {
  event: 'post-edit';
  handler(context: {
    filePath: string;
    workspacePath: string;
    projectContext: ProjectContext;
  }): Promise<HookResult>;
}

async function postEditHook(context: {
  filePath: string;
  workspacePath: string;
  projectContext: ProjectContext;
}): Promise<HookResult> {
  const { filePath, projectContext } = context;
  const ext = path.extname(filePath);
  const results: string[] = [];

  // 1. Determinar formatter
  const formatter = detectFormatter(projectContext);
  if (formatter) {
    const formatResult = await runFormatter(formatter, filePath);
    if (formatResult.changed) {
      results.push(`✓ Formatado com ${formatter.name}`);
    }
  }

  // 2. Determinar linter
  const linter = detectLinter(projectContext, ext);
  if (linter) {
    const lintResult = await runLinter(linter, filePath);
    if (lintResult.errors > 0) {
      results.push(`⚠ ${linter.name}: ${lintResult.errors} erros`);
      return {
        action: 'warn',
        reason: `Lint encontrou ${lintResult.errors} erros em ${filePath}`,
        details: lintResult.output,
      };
    } else {
      results.push(`✓ ${linter.name}: 0 erros`);
    }
  }

  return {
    action: 'log',
    details: results.join('\n'),
  };
}

function detectFormatter(ctx: ProjectContext): FormatterConfig | null {
  if (ctx.conventions?.formatter === 'prettier') {
    return { name: 'Prettier', command: 'npx prettier --write' };
  }
  if (ctx.conventions?.formatter === 'black') {
    return { name: 'Black', command: 'black' };
  }
  if (ctx.stack?.includes('go')) {
    return { name: 'gofmt', command: 'gofmt -w' };
  }
  if (ctx.stack?.includes('rust')) {
    return { name: 'rustfmt', command: 'rustfmt' };
  }
  return null;
}

function detectLinter(ctx: ProjectContext, ext: string): LinterConfig | null {
  const tsExtensions = ['.ts', '.tsx', '.js', '.jsx'];
  const pyExtensions = ['.py'];

  if (tsExtensions.includes(ext) && ctx.conventions?.linter === 'eslint') {
    return { name: 'ESLint', command: 'npx eslint --no-error-on-unmatched-pattern' };
  }
  if (pyExtensions.includes(ext) && ctx.conventions?.linter === 'pylint') {
    return { name: 'Pylint', command: 'pylint' };
  }
  return null;
}
```

## Comportamento

### Após edição bem-sucedida:
```
✓ Formatado com Prettier
✓ ESLint: 0 erros
```

### Após edição com erros de lint:
```
✓ Formatado com Prettier
⚠ ESLint: 2 erros
  src/Header.tsx:15:3 - 'unused' is defined but never used
  src/Header.tsx:22:5 - Missing return type

→ Agent tenta corrigir automaticamente (via skill test-lint-fix)
```

### Se formatter não está disponível:
Execução silenciosa — não bloqueia a edição.

## Configuração

```json
{
  "post-edit": {
    "formatter": true,
    "linter": true,
    "typecheck": false,
    "ignorePaths": [
      "*.md",
      "*.json",
      "*.yaml"
    ]
  }
}
```
