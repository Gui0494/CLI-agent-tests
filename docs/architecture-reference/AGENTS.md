# AGENTS.md — Convenções Obrigatórias do Projeto

## Identidade

Este é um CLI Agent de produção que opera no terminal. Ele executa ações reais, pesquisa informação real e nunca simula resultados.

## Fonte de Verdade

Para nomes, enums, permissões e contratos, a referência canônica é `specs/contracts.md`. Em caso de divergência entre qualquer arquivo e o contracts.md, **contracts.md vence**.

## Regras Invioláveis

### 1. Zero Simulação
- NUNCA finja que executou um comando. Execute de fato ou declare indisponibilidade.
- NUNCA finja pesquisa web. Use `web_search`/`web_fetch`/MCP ou declare que não pode pesquisar.
- NUNCA finja preview. Suba o servidor de fato ou declare que não pode.
- NUNCA finja mudança de modo. O modo deve ser alterado no session state real.
- NUNCA invente conteúdo de arquivo. Leia o arquivo real.
- NUNCA invente output de comando. Execute e capture stdout/stderr real.

### 2. Modos Operacionais Reais
- **CHAT**: apenas conversa, leitura de arquivos. Zero side effects.
- **PLAN**: apenas planejamento. Zero execução de comandos ou edição.
- **ACT**: execução real com permissão. Cada ação passa por permission check.
- **AUTO**: plan + act em loop. Aprovação inicial libera apenas read, write-local, shell-safe, git-local, network e preview. Ações críticas (shell-unsafe, git-remote, install, deploy, publish, db-write) **sempre pedem confirmação individual**, mesmo em AUTO. Ver `specs/contracts.md` seção 5.
- **RESEARCH**: pesquisa real via web/MCP. Zero edição de arquivos.

Se o modo atual não permite a ação, declare que precisa trocar de modo.

### 3. Segurança
- Comandos destrutivos (`rm -rf`, `del /f /q`, `mkfs`, `dd`, fork bombs) são **BLOQUEADOS** pelo hook `pre-shell`.
- Escrita fora do workspace é **BLOQUEADA** pelo hook `pre-write` (workspace-sandbox).
- Secrets (API keys, tokens, senhas) **NUNCA** são armazenados em memória ou logs.
- MCPs de terceiros **NUNCA** são automaticamente confiáveis.
- No início de cada sessão, o hook `on-session-start` executa o **doctor/healthcheck** para verificar disponibilidade de tools.

### 4. Disponibilidade de Ferramentas
Toda ação que depende de ferramenta externa deve ser classificada:
- `available` — ferramenta instalada e funcional.
- `unavailable` — ferramenta não disponível. Declarar claramente.
- `dev-only` — funciona apenas em ambiente de desenvolvimento.

Se uma ferramenta está `unavailable`, o agent DEVE dizer:
> "Não posso executar esta ação porque [ferramenta X] não está disponível. Para habilitar, [instruções]."

### 5. Autocorreção
- Se um comando falha, o agent analisa stderr e tenta corrigir (máximo 3 tentativas).
- Se todas as tentativas falham, reporta o erro completo ao usuário.
- O agent NUNCA ignora erros silenciosamente.

## Workflows Obrigatórios

### Antes de Qualquer Implementação
1. Rodar `repo-intel` se o project context está vazio.
2. Se a tarefa envolve API/SDK/framework externo, rodar `current-docs` para consultar documentação atual.
3. Gerar plano com `task-planner` antes de editar.

### Após Implementação
1. Rodar `test-lint-fix` para verificar testes e lint.
2. Rodar `security-review` para verificar vulnerabilidades.
3. Se commit necessário, usar `git-pr-helper` para gerar commit message adequado.

### Antes de Deploy
1. Rodar `release-deploy-checklist` obrigatoriamente.
2. Hook `pre-deploy` deve exigir aprovação humana.

## Estrutura de Skills

Skills ficam em `skills/` e seguem o formato definido em `specs/skill-user.md`.

**Skills obrigatórias do projeto:**
- `repo-intel` — leitura de codebase e detecção de stack
- `current-docs` — consulta de documentação atualizada (obrigatória antes de mexer com APIs)
- `implement-minimal-diff` — mudanças mínimas e localizadas
- `test-lint-fix` — testes, lint e typecheck
- `git-pr-helper` — branch, commit, PR
- `docs-writer` — atualização de documentação

## Estrutura de Subagents

Subagents ficam em `subagents/` e seguem o formato definido em `specs/architecture.md`.

**Subagents obrigatórios:**
- `security-reviewer` — revisão de segurança com contexto próprio
- `architecture-reviewer` — revisão de arquitetura
- `researcher` — pesquisa profunda com web/MCP
- `bug-investigator` — investigação de bugs com evidência

## Hooks

Hooks ficam em `hooks/` e são determinísticos (sem LLM).

**Hooks obrigatórios:**
- `pre-shell` (evento: `pre-shell`) — bloqueia comandos destrutivos
- `workspace-sandbox` (evento: `pre-write`) — impede escrita fora do workspace
- `post-edit` (evento: `post-edit`) — roda formatter/lint
- `post-task` (evento: `post-task`) — gera resumo e diff
- `pre-deploy` (evento: `pre-deploy`) — exige checklist/aprovação
- `doctor` (evento: `on-session-start`) — healthcheck de tools no início da sessão

## MCPs

Configuração MCP fica em `mcp.md`.

**Regra:** Apenas MCPs de fontes confiáveis. Servidores MCP externos não são auditados automaticamente e devem ser tratados com cuidado.

## Formato de Commits

```
<type>(<scope>): <description>

[body opcional]

[footer opcional]
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`.

## Padrão de Código

- TypeScript strict mode.
- Sem `any` explícito.
- Funções com tipos de retorno explícitos.
- Testes para toda lógica de negócio.
- ESLint + Prettier antes de commit.
