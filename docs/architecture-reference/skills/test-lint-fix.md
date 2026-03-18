# Skill: test-lint-fix

## Objetivo
Roda testes, lint e typecheck no projeto. Se falhar, tenta corrigir automaticamente e explica a causa.

## Quando Usar
- Após qualquer edição de código (automático no hook post-edit).
- Quando o usuário pede para verificar o código.
- Antes de commit/push (automático no git-pr-helper).
- No modo AUTO, após cada ciclo de implementação.

## Trigger
```yaml
manual: true        # /skill test-lint-fix
auto: true
patterns:
  - "rode os testes"
  - "verifique"
  - "lint"
  - "typecheck"
  - pós-edição automático
```

## Entradas
| Input | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| scope | string | não | "all", "changed", "file:path" (padrão: "changed") |
| fix | boolean | não | Tentar corrigir erros automaticamente (padrão: true) |
| maxRetries | number | não | Máximo de tentativas de correção (padrão: 3) |

## Saídas
| Output | Tipo | Descrição |
|---|---|---|
| testResult | TestResult | Resultado dos testes |
| lintResult | LintResult | Resultado do lint |
| typeResult | TypeResult | Resultado do typecheck |
| fixes | Fix[] | Correções aplicadas automaticamente |
| status | 'pass' \| 'fail' | Status geral |

## Ferramentas Necessárias
- `shell` — executar comandos de teste/lint/typecheck
- `fs_read` — ler arquivos com erros
- `fs_write` — corrigir arquivos

## Fluxo

```
1. DETECTAR COMANDOS (se não no projectContext)
   ├── Ler package.json scripts
   ├── Detectar: test, lint, typecheck
   └── Se não encontrar → avisar e perguntar ao usuário

2. RODAR TYPECHECK (se TypeScript)
   ├── shell("npx tsc --noEmit")
   ├── Se passa → próximo step
   └── Se falha → analisar erros, tentar corrigir

3. RODAR LINT
   ├── shell("npm run lint") ou equivalente
   ├── Se passa → próximo step
   └── Se falha:
       ├── Tentar auto-fix: shell("npm run lint -- --fix")
       ├── Se auto-fix resolveu → próximo step
       └── Se não → analisar erros restantes, corrigir manualmente

4. RODAR TESTES
   ├── shell("npm test") ou equivalente
   │   ├── scope "changed" → adicionar flag de filtro
   │   └── scope "file:path" → filtrar por arquivo
   ├── Se passa → sucesso
   └── Se falha:
       ├── Analisar output: qual teste falhou e por quê
       ├── Ler arquivo de teste e arquivo testado
       ├── Identificar causa raiz
       ├── Corrigir (código ou teste)
       └── Rodar novamente

5. RELATÓRIO
   └── Resumo com status de cada verificação
```

## Exemplo de Correção Automática

```
LINT ERROR:
  src/Header.tsx:15:3 - 'isDark' is assigned but never used (@typescript-eslint/no-unused-vars)

ANÁLISE:
  Variável isDark declarada mas não usada no render.
  Provavelmente foi adicionada mas faltou usar no JSX.

AÇÃO:
  Verificar se isDark deveria ser usado no className ou condicional.
  Se sim → adicionar uso.
  Se não → remover declaração.

RESULTADO:
  fs_read("src/Header.tsx") → confirma que isDark deveria controlar className
  Correção aplicada: adicionado uso de isDark no className
  Lint re-executado: 0 erros ✓
```

## Limites
- Timeout de testes: 120s (configurável).
- Máximo de 3 tentativas de correção por erro.
- Não corrige testes que testam comportamento incorreto (avisa o usuário).
- Se testes demoram mais que 120s, aborta e sugere rodar manualmente.

## Falhas Comuns
| Falha | Causa | Solução |
|---|---|---|
| Comando de teste não encontrado | package.json sem script test | Perguntar ao usuário |
| Testes infinitos | Teste com loop ou timeout longo | Abortar após 120s |
| Lint conflita com prettier | Configs incompatíveis | Avisar, não tentar corrigir config |
| Typecheck lento | Projeto grande | Rodar apenas no arquivo alterado |

## Exemplo Prático

**Execução após edição de Header.tsx:**

```
[⚡ ACT] Verificando código...

  ⠋ TypeScript...
  ✓ TypeScript: 0 erros

  ⠋ ESLint...
  ✗ ESLint: 2 erros
    src/Header.tsx:5:10 - 'Moon' is defined but never used
    src/Header.tsx:12:5 - Missing return type on function

  ⠋ Corrigindo...
  ✓ Removido import não usado 'Moon'
  ✓ Adicionado return type 'JSX.Element'

  ⠋ ESLint (re-check)...
  ✓ ESLint: 0 erros

  ⠋ Testes...
  ✓ Testes: 8 passed, 0 failed

  ✓ Todas as verificações passaram
```
