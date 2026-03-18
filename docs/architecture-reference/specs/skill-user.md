# Skill User Guide — Especificação

## 1. O que é uma Skill

Uma skill é um workflow reutilizável que o agent executa para resolver uma categoria específica de problema. Skills são composições de múltiplas tool calls com lógica de decisão entre elas.

**Skills NÃO são:**
- Simulações de ação.
- Prompts genéricos.
- Subagents (skills não têm contexto próprio persistente).

**Skills SÃO:**
- Sequências de passos concretos.
- Composições de tools reais.
- Workflows com entradas, saídas e critérios de sucesso definidos.

## 2. Anatomia de uma Skill

```yaml
# Cada skill segue esta estrutura
name: nome-da-skill
version: 1.0
description: O que esta skill faz em uma frase.

trigger:
  manual: true/false          # pode ser invocada por /skill <nome>
  auto: true/false            # pode ser detectada automaticamente
  patterns:                   # patterns que ativam a skill automaticamente
    - "pattern regex ou keyword"

required_tools:               # tools que a skill precisa
  - tool_name

inputs:                       # o que a skill recebe
  - name: input_name
    type: string
    required: true/false
    description: "descrição"

outputs:                      # o que a skill retorna
  - name: output_name
    type: string
    description: "descrição"

steps:                        # sequência de passos
  - id: step_1
    action: "descrição da ação"
    tool: tool_name
    on_error: retry|skip|abort

limits:                       # restrições
  max_duration: 60s
  max_tool_calls: 20
  requires_approval: true/false
```

## 3. Como o Usuário Interage com Skills

### 3.1 Invocação Manual

```
> /skill repo-intel
```

O agent executa a skill `repo-intel` e retorna o resultado.

### 3.2 Invocação com Parâmetros

```
> /skill dependency-research react@19
```

O agent executa a skill `dependency-research` passando `react@19` como input.

### 3.3 Detecção Automática

O usuário não precisa invocar a skill explicitamente. O agent detecta que a skill é relevante com base no contexto.

**Exemplo:** Se o usuário pede "atualiza o React para a versão 19", o agent automaticamente ativa `dependency-research` antes de fazer a atualização.

### 3.4 Listagem de Skills

```
> /skills
```

Exibe todas as skills disponíveis com descrição e status.

```
Skills disponíveis:
  repo-intel            Lê codebase e detecta stack          [disponível]
  task-planner          Transforma pedido em plano            [disponível]
  implement-minimal-diff Faz mudanças pequenas e localizadas  [disponível]
  test-lint-fix         Roda testes, lint e typecheck          [disponível]
  current-docs          Consulta docs atuais via web           [requer web_search]
  git-pr-helper         Gera branch, commit, PR                [requer git]
  security-review       Analisa segurança do código            [disponível]
  dependency-research   Pesquisa versões e compatibilidade     [requer web_search]
  release-deploy-checklist  Checklist de deploy                [disponível]
  project-conventions   Aplica padrões do projeto              [disponível]
  docs-writer           Atualiza documentação                  [disponível]
```

### 3.5 Detalhes de uma Skill

```
> /skill info repo-intel
```

Exibe a spec completa da skill: objetivo, inputs, outputs, steps, limites.

## 4. Ciclo de Vida de uma Skill

```
INVOCAÇÃO (manual ou auto)
    │
    ▼
VALIDAÇÃO DE PRÉ-REQUISITOS
    │
    ├── Tools necessárias disponíveis? ── NÃO ──▶ informa indisponibilidade
    │                                              lista o que falta
    │
    ├── Inputs válidos? ── NÃO ──▶ pede inputs faltantes ao usuário
    │
    └── Permissões OK? ── NÃO ──▶ pede aprovação
         │
         ▼
EXECUÇÃO DOS STEPS
    │
    ├── Step 1 → executa tool → verifica resultado
    ├── Step 2 → executa tool → verifica resultado
    │   (se erro: retry/skip/abort conforme config)
    ├── Step N → executa tool → verifica resultado
    │
    ▼
RETORNO
    │
    ├── Resultado estruturado ao agent loop
    ├── Resumo para o usuário
    └── Atualização de memória (se aplicável)
```

## 5. Criando uma Skill Personalizada

O usuário pode criar skills personalizadas colocando um arquivo `.md` ou `.yaml` no diretório `skills/` do projeto.

### Exemplo: skill personalizada para rodar e2e tests

```yaml
# skills/e2e-tests.yaml
name: e2e-tests
version: 1.0
description: Roda testes end-to-end com Playwright e analisa falhas.

trigger:
  manual: true
  auto: true
  patterns:
    - "e2e"
    - "end.to.end"
    - "playwright"

required_tools:
  - shell

inputs:
  - name: filter
    type: string
    required: false
    description: "Filtro para rodar testes específicos (ex: 'login')"

outputs:
  - name: results
    type: object
    description: "Resultado dos testes com detalhes de falhas"

steps:
  - id: check_playwright
    action: "Verificar se Playwright está instalado"
    tool: shell
    command: "npx playwright --version"
    on_error: abort
    error_message: "Playwright não encontrado. Rode: npm install -D @playwright/test"

  - id: run_tests
    action: "Executar testes e2e"
    tool: shell
    command: "npx playwright test {{filter}}"
    on_error: continue

  - id: analyze_failures
    action: "Se houve falhas, analisar logs e screenshots"
    condition: "step.run_tests.exit_code != 0"
    tool: fs_read
    path: "test-results/"
    on_error: skip

  - id: report
    action: "Gerar relatório com resultados"
    tool: none
    output: "Resumo dos testes, falhas encontradas e sugestões de correção"

limits:
  max_duration: 300s
  max_tool_calls: 10
  requires_approval: false
```

## 6. Skills vs Subagents vs Hooks

| Aspecto | Skill | Subagent | Hook |
|---|---|---|---|
| Contexto | Usa contexto do agent principal | Contexto próprio isolado | Sem contexto LLM |
| Complexidade | Workflow sequencial | Análise profunda | Regra determinística |
| Envolve LLM | Sim (via agent loop) | Sim (instância própria) | Não |
| Persistência | Não | Não (por padrão) | Não |
| Customizável | Sim (arquivos no projeto) | Sim (definições) | Sim (configuração) |
| Quando usar | Tarefas procedurais com passos claros | Análise especializada | Automação de regras fixas |

## 7. Prioridade de Execução

Quando múltiplas skills podem ser ativadas, o agent segue esta prioridade:

1. **Skill invocada manualmente** — sempre tem prioridade máxima.
2. **repo-intel** — se o project context está vazio, roda antes de qualquer outra skill.
3. **current-docs** — se a tarefa envolve API/SDK/framework, SEMPRE roda antes de qualquer implementação. **BLOQUEANTE:** se não houver ferramenta de pesquisa, a implementação NÃO prossegue.
4. **test-lint-fix** — roda depois de implementação (primeiro).
5. **security-review** — roda depois de test-lint-fix (segundo).
6. **git-pr-helper** — roda depois de security-review, se commit necessário (terceiro).
7. **Outras skills** — ordem definida pelo agent loop baseado no contexto.

> **Referência canônica:** ver `specs/contracts.md` seções 8 e 9 para a ordem definitiva.

## 8. Tratamento de Erros em Skills

```typescript
interface SkillError {
  skillName: string;
  step: string;
  error: string;
  recovery: 'retry' | 'skip' | 'abort' | 'ask_user';
  suggestion: string;
}

// Exemplo de tratamento
async function handleSkillError(error: SkillError): Promise<void> {
  switch (error.recovery) {
    case 'retry':
      // Tenta o step novamente (máximo 3 vezes)
      await retryStep(error.step, 3);
      break;
    case 'skip':
      // Pula o step e continua
      log.warn(`Pulando step ${error.step}: ${error.error}`);
      break;
    case 'abort':
      // Para a skill inteira
      throw new SkillAbortError(error);
    case 'ask_user':
      // Pergunta ao usuário o que fazer
      const decision = await askUser(
        `Skill "${error.skillName}" falhou no step "${error.step}": ${error.error}\n` +
        `Sugestão: ${error.suggestion}\n` +
        `O que deseja fazer? [retry/skip/abort]`
      );
      await handleSkillError({ ...error, recovery: decision });
      break;
  }
}
```
