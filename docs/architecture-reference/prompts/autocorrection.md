# Prompt — Autocorreção

## Objetivo

Ensinar o agent a detectar erros em execuções reais e se autocorrigir de forma estruturada, sem fingir que corrigiu.

## Princípio

O agent DEVE:
1. Detectar erros reais (stdout/stderr/exit code).
2. Analisar a causa raiz.
3. Propor e executar correção.
4. Verificar se a correção funcionou.
5. Se falhou 3 vezes, reportar ao usuário com contexto completo.

O agent NUNCA DEVE:
- Ignorar erros silenciosamente.
- Dizer "corrigido" sem ter verificado.
- Repetir o mesmo comando sem alteração.

## Fluxo de Autocorreção

```
EXECUÇÃO DE TOOL
    │
    ▼
RESULTADO
    │
    ├── exit code 0 + sem stderr relevante → SUCESSO
    │
    └── exit code != 0 OU stderr com erro → ERRO DETECTADO
         │
         ▼
    ANÁLISE DO ERRO
    │
    ├── Tipo: sintaxe → corrigir código gerado
    ├── Tipo: dependência faltando → instalar dependência
    ├── Tipo: permissão negada → informar usuário
    ├── Tipo: arquivo não encontrado → verificar path
    ├── Tipo: porta em uso → tentar outra porta
    ├── Tipo: timeout → aumentar timeout ou simplificar
    ├── Tipo: OOM → abortar, informar usuário
    └── Tipo: desconhecido → pesquisar erro (se RESEARCH disponível)
         │
         ▼
    TENTATIVA DE CORREÇÃO (max 3)
    │
    ├── Tentativa 1: correção direta baseada no erro
    │   └── Executar → verificar resultado
    │
    ├── Tentativa 2: abordagem alternativa
    │   └── Executar → verificar resultado
    │
    └── Tentativa 3: simplificação máxima
        └── Executar → verificar resultado
             │
             ▼
        TODAS FALHARAM
             │
             ▼
        REPORTAR AO USUÁRIO:
        "Não consegui resolver após 3 tentativas.
         Tentativa 1: [o que fiz] → [erro]
         Tentativa 2: [o que fiz] → [erro]
         Tentativa 3: [o que fiz] → [erro]
         Sugestão: [ação manual recomendada]"
```

## Exemplo Real: Erro de Compilação

```typescript
// Tentativa 1: Agent gera código
async function handleCompilationError(error: ExecutionResult): Promise<void> {
  // Erro real capturado:
  // stderr: "src/components/Header.tsx(15,3): error TS2322:
  //          Type 'string' is not assignable to type 'boolean'"

  // Análise: tipo errado na linha 15
  // Ação: ler o arquivo, encontrar linha 15, corrigir tipo

  const file = await readFile('src/components/Header.tsx');
  const lines = file.split('\n');
  // Linha 15: const isDark: boolean = theme  ← theme é string
  // Correção: const isDark = theme === 'dark'

  await editFile('src/components/Header.tsx', {
    line: 15,
    old: "const isDark: boolean = theme",
    new: "const isDark = theme === 'dark'"
  });

  // Verificar: rodar typecheck novamente
  const recheck = await executeShell('npx tsc --noEmit');

  if (recheck.exitCode === 0) {
    // Sucesso na autocorreção
    render('✓ Erro de tipo corrigido na linha 15 de Header.tsx');
  } else {
    // Ainda com erro → tentativa 2
    await handleCompilationError(recheck);  // recursão com controle de max
  }
}
```

## Exemplo Real: Teste Falhando

```
EXECUÇÃO: npm test
EXIT CODE: 1
STDERR:
  FAIL src/components/Header.test.tsx
  ● Header › should toggle dark mode
    Expected: true
    Received: false
    at Object.<anonymous> (src/components/Header.test.tsx:25:5)

ANÁLISE:
  - Teste espera que dark mode toggle funcione
  - O valor esperado é `true` mas recebeu `false`
  - Provavelmente o state não está sendo atualizado

CORREÇÃO TENTATIVA 1:
  - Ler Header.tsx e Header.test.tsx
  - Verificar lógica de toggle
  - Encontrar: setDark(!dark) dentro de onClick
  - Verificar se o useState está inicializado corretamente
  - Corrigir se necessário

VERIFICAÇÃO:
  - Rodar npm test novamente
  - Se passar → sucesso
  - Se falhar → tentativa 2 com abordagem diferente
```

## Padrões de Erro Conhecidos

```typescript
const ERROR_PATTERNS: ErrorHandler[] = [
  {
    pattern: /Cannot find module '(.+)'/,
    type: 'missing-dependency',
    fix: async (match) => {
      const moduleName = match[1];
      await executeShell(`npm install ${moduleName}`);
    }
  },
  {
    pattern: /EADDRINUSE.*:(\d+)/,
    type: 'port-in-use',
    fix: async (match) => {
      const port = match[1];
      const newPort = parseInt(port) + 1;
      // Tentar com porta diferente
      await executeShell(`PORT=${newPort} npm start`);
    }
  },
  {
    pattern: /SyntaxError: Unexpected token/,
    type: 'syntax-error',
    fix: async () => {
      // Reler o arquivo que foi editado por último
      // Verificar sintaxe
      // Corrigir
    }
  },
  {
    pattern: /error TS\d+:/,
    type: 'typescript-error',
    fix: async () => {
      // Parsear a mensagem de erro do TypeScript
      // Localizar arquivo e linha
      // Corrigir tipo
    }
  },
  {
    pattern: /ERR_MODULE_NOT_FOUND/,
    type: 'esm-import-error',
    fix: async () => {
      // Verificar extensão do import
      // Verificar package.json type: "module"
      // Corrigir import
    }
  },
];
```

## Regras de Autocorreção

1. **Nunca repetir o mesmo comando idêntico** — se falhou uma vez, vai falhar de novo.
2. **Cada tentativa deve ser diferente** — abordagem alternativa, não repetição.
3. **Manter contexto entre tentativas** — referenciar erros anteriores.
4. **Não escalar sem necessidade** — se é um erro de sintaxe, corrija a sintaxe; não reinstale tudo.
5. **Respeitar limites** — máximo 3 tentativas por erro; não entrar em loop infinito.
6. **Reportar com transparência** — mostrar ao usuário exatamente o que tentou e por que falhou.
