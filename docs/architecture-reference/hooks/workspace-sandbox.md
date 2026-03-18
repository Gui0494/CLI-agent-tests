# Hook: workspace-sandbox

## Evento
`pre-write` — dispara antes de qualquer operação de escrita no filesystem.

## Ação
`block` — bloqueia escrita fora do workspace do projeto.

## Objetivo
Garantir que o agent nunca escreva arquivos fora do diretório do projeto, prevenindo danos ao sistema.

## Implementação

```typescript
import path from 'path';
import fs from 'fs';

interface WorkspaceSandboxHook {
  event: 'pre-write';
  handler(context: {
    targetPath: string;
    workspacePath: string;
    operation: 'write' | 'create' | 'delete' | 'rename';
  }): HookResult;
}

function workspaceSandboxHook(context: {
  targetPath: string;
  workspacePath: string;
  operation: string;
}): HookResult {
  const { targetPath, workspacePath, operation } = context;

  // 1. Resolver path absoluto
  const resolvedTarget = path.resolve(targetPath);
  const resolvedWorkspace = path.resolve(workspacePath);

  // 2. Verificar se está dentro do workspace
  if (!resolvedTarget.startsWith(resolvedWorkspace + path.sep) &&
      resolvedTarget !== resolvedWorkspace) {
    return {
      action: 'block',
      reason: `Operação "${operation}" bloqueada: "${resolvedTarget}" está fora do workspace "${resolvedWorkspace}".`,
      suggestion: 'O agent só pode modificar arquivos dentro do diretório do projeto.',
    };
  }

  // 3. Verificar symlinks que apontam para fora
  try {
    const realPath = fs.realpathSync(path.dirname(resolvedTarget));
    if (!realPath.startsWith(resolvedWorkspace)) {
      return {
        action: 'block',
        reason: `Operação bloqueada: path resolve para "${realPath}" via symlink, que está fora do workspace.`,
        suggestion: 'Symlinks para fora do workspace não são permitidos.',
      };
    }
  } catch {
    // Diretório não existe ainda (novo arquivo) — verificar parent
    const parentDir = path.dirname(resolvedTarget);
    if (!parentDir.startsWith(resolvedWorkspace)) {
      return {
        action: 'block',
        reason: `Diretório pai "${parentDir}" está fora do workspace.`,
      };
    }
  }

  // 4. Verificar paths sensíveis dentro do workspace
  const PROTECTED_PATTERNS = [
    /\.git\/(?!ignore)/,        // permitir .gitignore mas proteger .git/
    /node_modules\//,           // não editar dentro de node_modules
    /\.env(?!\.example)/,       // proteger .env (permitir .env.example)
  ];

  const relativePath = path.relative(resolvedWorkspace, resolvedTarget);
  for (const pattern of PROTECTED_PATTERNS) {
    if (pattern.test(relativePath)) {
      return {
        action: 'warn',
        reason: `Arquivo "${relativePath}" é protegido.`,
        suggestion: 'Confirme que deseja editar este arquivo.',
      };
    }
  }

  return { action: 'allow' };
}
```

## Comportamento

### Tentativa de escrita fora do workspace:
```
[⊘ BLOQUEADO] Escrita em: /etc/hosts
Motivo: Arquivo está fora do workspace /home/user/meu-projeto.
O agent só pode modificar arquivos dentro do diretório do projeto.
```

### Tentativa de escrita em path protegido:
```
[⚠ ATENÇÃO] Escrita em: .env
Motivo: Arquivo .env é protegido (pode conter secrets).
Deseja continuar? [s/N]
```

### Escrita válida:
Execução silenciosa, sem mensagem extra.

## Casos de Borda

- **Path traversal:** `../../../etc/passwd` → bloqueado (resolve para fora).
- **Symlink malicioso:** `/workspace/link → /etc/` → bloqueado (realpath fora).
- **Novo diretório:** `/workspace/new/dir/file.ts` → permitido (dentro do workspace).
- **Home dir:** `~/file.txt` → bloqueado (fora do workspace).

## Cross-Platform

```typescript
// Normalização de paths cross-platform
function normalizePath(p: string): string {
  // Windows: converter backslash para forward slash para comparação
  return path.resolve(p).replace(/\\/g, '/');
}

// Em Windows, a comparação com path.sep pode falhar
// porque path.resolve retorna backslash mas o input pode vir com forward slash.
// Sempre normalizar antes de comparar.

// WSL: paths /mnt/c/... mapeiam para C:\ do Windows.
// O workspace sandbox deve respeitar o path como está no sistema operacional atual.
// Se estamos em WSL, /mnt/c é um path válido e o sandbox funciona normalmente.
```
