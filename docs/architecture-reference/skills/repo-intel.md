# Skill: repo-intel

## Objetivo
Lê a codebase, detecta stack tecnológica, comandos de build/test, estrutura de pastas e arquivos críticos.

## Quando Usar
- Início de sessão (primeira interação com o projeto).
- Quando o project context está vazio.
- Quando o usuário pede para analisar o projeto.
- Antes de qualquer skill que depende de contexto do projeto.

## Trigger
```yaml
manual: true        # /skill repo-intel
auto: true          # ativa automaticamente quando project context está vazio
patterns:
  - "analise o projeto"
  - "que stack"
  - "que tecnologias"
  - "estrutura do projeto"
```

## Entradas
| Input | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| workspacePath | string | sim | Caminho do workspace (padrão: cwd) |
| depth | number | não | Profundidade de análise de diretórios (padrão: 3) |

## Saídas
| Output | Tipo | Descrição |
|---|---|---|
| stack | string[] | Tecnologias detectadas (ex: ["react", "typescript", "tailwind"]) |
| buildCommand | string | Comando de build (ex: "npm run build") |
| testCommand | string | Comando de teste (ex: "npm test") |
| lintCommand | string | Comando de lint (ex: "npm run lint") |
| structure | string | Árvore de diretórios resumida |
| criticalFiles | string[] | Arquivos importantes (package.json, config, etc.) |
| conventions | object | Padrões detectados (formatter, linter, estilo) |

## Ferramentas Necessárias
- `fs_read` — ler arquivos de configuração
- `fs_glob` — listar estrutura de diretórios
- `fs_grep` — buscar patterns em arquivos

## Fluxo

```
1. LISTAR ESTRUTURA
   └── fs_glob("**/*", depth: 3)
   └── Ignorar: node_modules, .git, dist, build, __pycache__

2. LER ARQUIVOS DE CONFIGURAÇÃO
   ├── package.json → detectar dependências, scripts
   ├── tsconfig.json → TypeScript config
   ├── .eslintrc* → ESLint config
   ├── .prettierrc* → Prettier config
   ├── vite.config.* → Vite
   ├── next.config.* → Next.js
   ├── requirements.txt / pyproject.toml → Python
   ├── Cargo.toml → Rust
   ├── go.mod → Go
   ├── Makefile → comandos make
   ├── docker-compose.yml → Docker
   └── .env.example → variáveis de ambiente

3. DETECTAR STACK
   ├── Analisar dependências do package.json
   ├── Verificar arquivos de config presentes
   ├── Verificar extensões de arquivo dominantes
   └── Classificar: frontend, backend, fullstack, CLI, lib

4. DETECTAR COMANDOS
   ├── Ler scripts do package.json
   ├── Ler Makefile se existir
   ├── Inferir: build, test, lint, dev, start
   └── Se não encontrar, marcar como "não detectado"

5. DETECTAR CONVENÇÕES
   ├── Formatter (prettier, black, gofmt)
   ├── Linter (eslint, pylint, clippy)
   ├── Test framework (jest, vitest, pytest, cargo test)
   ├── Commit pattern (conventional commits, outro)
   └── Arquitetura (feature-based, layer-based, monorepo)

6. GERAR OUTPUT ESTRUTURADO
   └── Retornar ProjectContext completo
```

## Limites
- Não executa comandos shell (apenas leitura).
- Profundidade máxima de análise: 5 níveis.
- Ignora arquivos binários.
- Timeout: 30s.

## Falhas Comuns
| Falha | Causa | Solução |
|---|---|---|
| Stack não detectada | Projeto sem package.json nem arquivos de config padrão | Perguntar ao usuário |
| Muitos arquivos | Monorepo ou projeto muito grande | Limitar a depth 2, focar em root |
| Permissão negada | Arquivo sem permissão de leitura | Pular arquivo, avisar |

## Exemplo Prático

**Input:** workspace = `/home/user/meu-app`

**Execução:**
```
fs_glob("**/*", depth: 3, ignore: ["node_modules", ".git"])
→ 47 arquivos encontrados

fs_read("package.json")
→ dependencies: react, next, tailwind
→ scripts: { build: "next build", test: "vitest", lint: "eslint ." }

fs_read("tsconfig.json")
→ TypeScript strict mode

fs_read(".eslintrc.json")
→ ESLint com plugin react
```

**Output:**
```json
{
  "stack": ["next.js", "react", "typescript", "tailwind", "vitest", "eslint"],
  "buildCommand": "npm run build",
  "testCommand": "npm test",
  "lintCommand": "npm run lint",
  "structure": "src/\n  components/\n  pages/\n  styles/\n  utils/\npublic/\ntests/",
  "criticalFiles": ["package.json", "tsconfig.json", "next.config.js", ".env.example"],
  "conventions": {
    "formatter": "prettier",
    "linter": "eslint",
    "testFramework": "vitest",
    "architecture": "next.js app router"
  }
}
```
