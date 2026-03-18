# Skill: project-conventions

## Objetivo
Aplica padrões do projeto: estilo de código, arquitetura, nomes, commit pattern e regras internas.

## Quando Usar
- No início de sessão (junto com repo-intel).
- Quando o agent precisa escrever código novo.
- Quando o usuário configura convenções.

## Trigger
```yaml
manual: true        # /skill project-conventions
auto: true
patterns:
  - "padrão do projeto"
  - "convenções"
  - "estilo de código"
  - ativação junto com repo-intel
```

## Entradas
| Input | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| action | string | não | "detect" (padrão), "apply", "set" |
| rules | Rule[] | não | Regras customizadas (para action "set") |

## Saídas
| Output | Tipo | Descrição |
|---|---|---|
| conventions | Conventions | Convenções detectadas/configuradas |
| violations | Violation[] | Violações encontradas (se action "apply") |

## Ferramentas Necessárias
- `fs_read` — ler configs e código existente
- `fs_grep` — buscar padrões
- `fs_write` — salvar .agent/conventions.json

## Fluxo

```
1. DETECTAR CONVENÇÕES AUTOMÁTICAS
   ├── Formatter: prettier? black? gofmt?
   ├── Linter: eslint? pylint? clippy?
   ├── Indentação: tabs? espaços? quantos?
   ├── Quotes: single? double?
   ├── Semicolons: sim? não?
   ├── Naming: camelCase? snake_case? PascalCase?
   ├── Test pattern: *.test.ts? *.spec.ts? __tests__/?
   ├── Import style: absolute? relative? aliases?
   ├── Component pattern: functional? class? arrow?
   └── Commit pattern: conventional? freeform?

2. LER CONFIGURAÇÕES EXPLÍCITAS
   ├── .editorconfig
   ├── .eslintrc / eslint.config.js
   ├── .prettierrc
   ├── tsconfig.json → paths, strict
   ├── CONTRIBUTING.md
   └── .agent/conventions.json (se existir)

3. ANALISAR CÓDIGO EXISTENTE (por amostragem)
   ├── Ler 5 arquivos representativos
   ├── Extrair padrões dominantes
   └── Resolver conflitos (config vs prática)

4. SALVAR CONVENÇÕES
   └── Escrever .agent/conventions.json
```

## Regra Fundamental

Quando o agent escreve código novo, ele DEVE seguir as convenções detectadas:
- Se o projeto usa tabs → tabs.
- Se o projeto usa single quotes → single quotes.
- Se o projeto usa functional components → functional components.
- Se o projeto usa camelCase → camelCase.

**Nunca impor estilo diferente do que o projeto já usa.**

## Limites
- Detecção por amostragem (não lê todos os arquivos).
- Se há conflito entre config e prática, prioriza config.
- Timeout: 30s.

## Exemplo Prático

**Output detectado:**
```json
{
  "codeStyle": {
    "formatter": "prettier",
    "linter": "eslint",
    "indentation": "spaces-2",
    "quotes": "single",
    "semicolons": false,
    "trailingComma": "all"
  },
  "naming": {
    "variables": "camelCase",
    "components": "PascalCase",
    "files": "kebab-case",
    "constants": "UPPER_SNAKE_CASE"
  },
  "architecture": {
    "pattern": "feature-based",
    "testPattern": "*.test.tsx colocated",
    "componentPattern": "functional + hooks"
  },
  "git": {
    "commitPattern": "conventional-commits",
    "branchPattern": "feat|fix|chore/<description>"
  }
}
```
