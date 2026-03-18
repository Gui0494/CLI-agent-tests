# PRD — CLI Agent de Produção

## 1. Visão Geral

Agent CLI interativo que opera diretamente no terminal, capaz de executar tarefas reais de engenharia de software: leitura de código, edição, pesquisa web, execução de comandos, preview de projetos e gerenciamento de repositórios.

**Princípio fundamental:** Nenhuma ação pode ser simulada. Se o agent não tem acesso à ferramenta necessária, ele deve declarar explicitamente que a ação está indisponível.

## 2. Problema

Assistentes de código atuais frequentemente:
- Fingem ter executado comandos sem executar de fato.
- Simulam pesquisa web sem acessar a internet.
- Apresentam previews falsos sem servidor rodando.
- Não distinguem planejamento de execução.
- Não se autocorrigem com base em erros reais.

## 3. Objetivos

| Objetivo | Métrica de sucesso |
|---|---|
| Execução real de comandos shell | 100% dos comandos passam pelo executor real com stdout/stderr capturados |
| Pesquisa web real | Toda pesquisa usa tool/MCP real; zero respostas inventadas |
| Modos operacionais distintos | CHAT, PLAN, ACT, AUTO, RESEARCH com comportamento verificável |
| Autocorreção | Agent detecta erro em stdout/stderr e tenta correção em até 3 iterações |
| Preview real | Servidor de dev sobe de fato; URL é acessível; nunca finge preview |
| Segurança | Zero execução de comandos destrutivos sem aprovação explícita |

## 4. Público-alvo

Desenvolvedores que usam terminal como ambiente principal de trabalho e querem um assistente que opere no mesmo nível: lendo arquivos reais, executando comandos reais, fazendo pesquisas reais.

## 5. Modos Operacionais

### CHAT
- Conversa livre, sem efeitos colaterais.
- Não edita arquivos, não executa comandos.
- Pode ler arquivos se o usuário pedir.

### PLAN
- Analisa a tarefa e gera plano estruturado.
- **Não executa nenhuma ação.**
- Saída: lista de passos, arquivos afetados, riscos, ordem de execução.
- O plano deve ser aprovado antes de virar ACT.

### ACT
- Executa mudanças reais: edição de arquivos, comandos shell, criação de arquivos.
- Cada ação passa pelo sistema de permissões.
- Hooks de segurança rodam antes e depois de cada ação.

### AUTO
- Combina PLAN + ACT em loop contínuo.
- Agent planeja, executa, verifica resultado, corrige se necessário.
- Loop máximo configurável (padrão: 10 iterações).
- Requer aprovação inicial do usuário.

### RESEARCH
- Pesquisa informação via web/MCP.
- Não edita arquivos, não executa comandos destrutivos.
- Saída: informação estruturada com fontes.
- Se não houver tool de pesquisa disponível, declara indisponibilidade.

## 6. Funcionalidades Principais

### 6.1 Interface Terminal
- Renderização com cores ANSI, spinners, barras de progresso.
- Syntax highlighting para código.
- Painéis para diff, preview, status.
- Atalhos de teclado configuráveis.
- Indicador visual do modo atual (CHAT/PLAN/ACT/AUTO/RESEARCH).

### 6.2 Execução Real de Ferramentas
- Shell: executa comandos reais com captura de stdout/stderr/exit code.
- Filesystem: lê/escreve arquivos reais no disco.
- Web: pesquisa via tool real (web_search, fetch) ou MCP.
- Git: operações reais de git via CLI.
- Preview: sobe servidor de dev real e exibe URL.

### 6.3 Sistema de Skills
Skills são workflows reutilizáveis com instruções, recursos e scripts opcionais.
- Cada skill tem arquivo próprio com spec completa.
- Skills podem ser invocadas por nome ou detectadas automaticamente.
- Skills não têm contexto próprio persistente (diferente de subagents).

### 6.4 Sistema de Subagents
Subagents são especialistas com contexto próprio, prompt próprio e permissões próprias.
- Rodam em processo separado (ou contexto isolado).
- Retornam resultado estruturado ao agent principal.
- Úteis para tarefas que precisam de foco profundo sem poluir o contexto principal.

### 6.5 Sistema de Hooks
Hooks são automações determinísticas que disparam em momentos específicos.
- pre-shell: antes de executar qualquer comando.
- post-edit: depois de editar qualquer arquivo.
- post-task: ao finalizar uma tarefa.
- pre-deploy: antes de deploy.
- Hooks podem bloquear a ação (deny) ou apenas registrar (log).

### 6.6 Preview Runtime
- Detecta tipo de projeto (React, Next, Vue, static HTML, Python, etc.).
- Sobe servidor de dev apropriado (vite, next dev, python -m http.server, etc.).
- Exibe URL no terminal com opção de abrir no browser.
- Mata o processo ao sair do preview.
- Se não conseguir detectar ou subir o server, informa claramente.

## 7. Requisitos Não-Funcionais

| Requisito | Especificação |
|---|---|
| Latência de resposta | < 200ms para renderização de UI; latência de LLM depende do provider |
| Uso de memória | < 256MB para o processo do agent (excluindo subprocessos) |
| Segurança | Sandbox de workspace; blocklist de comandos; permissões granulares |
| Compatibilidade | Linux, macOS; Windows via WSL |
| Extensibilidade | Skills, subagents, hooks e MCPs adicionáveis sem alterar core |

## 8. Critérios de Aceite

- [ ] Agent executa `ls` e mostra saída real do filesystem.
- [ ] Agent pesquisa na web e retorna resultado com fonte real.
- [ ] Agent em modo PLAN não executa nenhuma ação.
- [ ] Agent em modo ACT edita arquivo e a mudança persiste no disco.
- [ ] Agent detecta erro em comando e tenta corrigir automaticamente.
- [ ] Agent sobe preview real de projeto React/Next e exibe URL.
- [ ] Agent bloqueia `rm -rf /` antes de executar.
- [ ] Agent declara indisponibilidade quando tool não existe.
- [ ] Hooks de lint rodam automaticamente após edição.
- [ ] Subagent de segurança roda e retorna relatório estruturado.

## 9. Fora de Escopo (v1)

- GUI desktop/web (apenas terminal).
- Suporte a múltiplos LLM providers simultaneamente (v1 suporta um).
- Marketplace de skills/plugins.
- Colaboração multi-usuário em tempo real.

## 10. Fases de Implementação

### Fase 1: Core
- Agent loop básico com CHAT e ACT.
- Executor de shell com captura de saída.
- Leitor/editor de arquivos.
- Interface terminal básica com cores.
- Hook de segurança para comandos destrutivos.

### Fase 2: Modos e Skills
- Modos PLAN, RESEARCH, AUTO.
- Skills: repo-intel, implement-minimal-diff, test-lint-fix.
- Sistema de hooks completo.
- Memória de sessão.

### Fase 3: Pesquisa e Preview
- Integração web search real.
- Preview runtime.
- Skills: current-docs, dependency-research.
- Subagents: researcher, security-reviewer.

### Fase 4: Produção
- Todas as skills restantes.
- Todos os subagents.
- Integrações MCP.
- Testes end-to-end.
- Documentação completa.
