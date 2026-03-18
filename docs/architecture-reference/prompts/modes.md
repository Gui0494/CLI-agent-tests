# Prompt — Modos Operacionais

## Objetivo

Definir o comportamento real de cada modo operacional. Cada modo tem restrições que são aplicadas no code, não apenas no prompt.

## Implementação de Modos

### Troca de Modo

```typescript
class ModeManager {
  private currentMode: Mode = 'CHAT';
  private modeHistory: Mode[] = [];

  // Nota: async porque AUTO requer confirmação do usuário (I/O)
  async switch(newMode: Mode): Promise<void> {
    // Validar transição (ver contracts.md seção 1 — VALID_TRANSITIONS)
    if (!this.isValidTransition(this.currentMode, newMode)) {
      throw new Error(`Transição ${this.currentMode} → ${newMode} não permitida`);
    }

    // PLAN → ACT requer plano aprovado
    if (this.currentMode === 'PLAN' && newMode === 'ACT' && !this.hasApprovedPlan()) {
      throw new Error('Transição PLAN → ACT requer plano aprovado pelo usuário.');
    }

    // AUTO requer confirmação do usuário
    if (newMode === 'AUTO') {
      const confirmed = await this.requestConfirmation(
        'Modo AUTO executa ações automaticamente.\n' +
        'Permissões liberadas: read, write-local, shell-safe, git-local, network, preview.\n' +
        'Ações críticas (shell-unsafe, git-remote, install, deploy, publish) ainda pedirão confirmação.\n' +
        'Confirma?'
      );
      if (!confirmed) return;
    }

    this.modeHistory.push(this.currentMode);
    this.currentMode = newMode;

    // Atualizar tools disponíveis conforme matriz de permissões
    // Referência: contracts.md seção 5 — MODE_PERMISSION_MATRIX
    this.updateAvailableTools(newMode);

    // Atualizar system prompt
    this.updateSystemPrompt(newMode);

    // Notificar UI
    this.emitModeChange(newMode);
  }

  private isValidTransition(from: Mode, to: Mode): boolean {
    // Referência canônica: contracts.md seção 1 — VALID_TRANSITIONS
    const validTargets = VALID_TRANSITIONS[from];
    return validTargets.includes(to);
  }
}
```

### CHAT — Conversa Sem Side Effects

```typescript
const CHAT_CONFIG = {
  allowedTools: ['fs_read', 'fs_glob', 'fs_grep'],
  blockedTools: ['shell', 'fs_write', 'git', 'preview'],
  systemPromptAddition: `
    Você está em modo CHAT. Pode conversar livremente e ler arquivos.
    NÃO execute comandos, NÃO edite arquivos, NÃO faça git operations.
    Se o usuário pedir ação que modifica algo, responda:
    "Para executar essa ação, mude para modo ACT com /mode act."
  `,
  enforceAtCodeLevel: true,  // não depende apenas do prompt
};
```

### PLAN — Planejamento Sem Execução

```typescript
const PLAN_CONFIG = {
  allowedTools: ['fs_read', 'fs_glob', 'fs_grep', 'web_search', 'web_fetch'],
  blockedTools: ['shell', 'fs_write', 'git', 'preview'],
  systemPromptAddition: `
    Você está em modo PLAN. Sua tarefa é gerar um plano estruturado.

    Formato obrigatório do plano:

    ## Objetivo
    [Uma frase descrevendo o objetivo]

    ## Arquivos Afetados
    - path/to/file.ts — [o que muda]
    - path/to/other.ts — [o que muda]

    ## Riscos
    - [risco 1 e como mitigar]
    - [risco 2 e como mitigar]

    ## Passos
    1. [ ] [descrição do passo]
       - Tools: [tools necessárias]
       - Dependências: [passos que precisam estar completos]
    2. [ ] [descrição do passo]
       ...

    ## Critérios de Aceite
    - [ ] [critério mensurável]
    - [ ] [critério mensurável]

    NÃO execute NENHUMA ação. Apenas planeje.
    O plano será revisado pelo usuário antes de executar.
  `,
  outputFormat: 'plan',
  requiresApproval: true,
};
```

### ACT — Execução Real

```typescript
const ACT_CONFIG = {
  allowedTools: ['*'],  // todos permitidos
  toolPermissions: {
    fs_read: 'allow',
    fs_glob: 'allow',
    fs_grep: 'allow',
    web_search: 'allow',
    web_fetch: 'allow',
    fs_write: 'ask',
    shell: 'ask',
    git: 'ask',
    preview: 'ask',
  },
  systemPromptAddition: `
    Você está em modo ACT. Execute ações reais.
    Cada ação que modifica algo requer aprovação do usuário.

    Regras:
    - Leia o arquivo ANTES de editar.
    - Mostre o diff ANTES de salvar.
    - Verifique o resultado DEPOIS de executar.
    - Se encontrar erro, tente autocorrigir (max 3x).
    - Rode testes/lint se relevante após edição.
  `,
  enforcePermissions: true,
  enableAutoCorrection: true,
  maxRetries: 3,
};
```

### AUTO — Loop Autônomo

```typescript
const AUTO_CONFIG = {
  // Referência: contracts.md seção 5 — MODE_PERMISSION_MATRIX[AUTO]
  // Aprovação inicial NÃO é cheque em branco.
  permissionsByClass: {
    'read':          'allow',     // liberado
    'write-local':   'allow',     // liberado
    'shell-safe':    'allow',     // liberado
    'shell-unsafe':  'ask',       // SEMPRE pede
    'git-local':     'allow',     // liberado
    'git-remote':    'ask',       // SEMPRE pede
    'network':       'allow',     // liberado
    'install':       'ask',       // SEMPRE pede
    'preview':       'allow',     // liberado
    'deploy':        'deny',      // NUNCA em AUTO
    'publish':       'deny',      // NUNCA em AUTO
    'db-write':      'deny',      // NUNCA em AUTO
  },
  systemPromptAddition: `
    Você está em modo AUTO. Execute o plano automaticamente.

    Permissões liberadas: leitura, escrita local, shell seguro, git local, rede, preview.
    Ações que SEMPRE pedem confirmação mesmo em AUTO:
    - Comandos potencialmente destrutivos (shell-unsafe)
    - Git push (git-remote)
    - Instalação de dependências (install)
    Ações PROIBIDAS em AUTO: deploy, publish, db-write.

    Loop:
    1. Analise o próximo passo do plano.
    2. Execute as ações necessárias.
    3. Verifique o resultado.
    4. Se houve erro, autocorrija.
    5. Se corrigiu, continue para o próximo passo.
    6. Se não conseguiu corrigir após 3 tentativas, PARE e reporte.
    7. Quando todos os passos estiverem completos, execute testes finais.

    PARE se:
    - Atingiu o máximo de iterações ({{MAX_ITERATIONS}}).
    - Erro fatal (OOM, disco cheio, permissão root).
    - Encontrou decisão ambígua que precisa de input do usuário.
  `,
  requiresInitialApproval: true,
  maxIterations: 10,
  enableAutoCorrection: true,
  maxRetries: 3,
  pauseOnAmbiguity: true,
};
```

### RESEARCH — Pesquisa Real

```typescript
const RESEARCH_CONFIG = {
  allowedTools: ['fs_read', 'fs_glob', 'fs_grep', 'web_search', 'web_fetch'],
  blockedTools: ['shell', 'fs_write', 'git', 'preview'],
  systemPromptAddition: `
    Você está em modo RESEARCH. Sua tarefa é pesquisar informação.

    Regras:
    - USE web_search/web_fetch para pesquisar na web.
    - SE não tem web_search disponível, DECLARE:
      "Pesquisa web indisponível. Ferramenta não configurada."
    - NUNCA invente resultados de pesquisa.
    - SEMPRE cite fontes com URL.
    - NÃO edite arquivos, NÃO execute comandos destrutivos.

    Formato de saída:

    ## Pesquisa: [tópico]

    ### Fontes Consultadas
    - [URL 1] — [resumo]
    - [URL 2] — [resumo]

    ### Descobertas
    [informação estruturada]

    ### Relevância para o Projeto
    [como isso se aplica ao contexto atual]
  `,
  outputFormat: 'research',
};
```

## Transições de Modo

```
     ┌──────┐     ┌──────┐
     │ CHAT │◄────│ PLAN │
     └──┬───┘     └──┬───┘
        │            │
        ▼            ▼ (com plano aprovado)
     ┌──────┐     ┌──────┐
     │RSRCH │     │ ACT  │
     └──────┘     └──┬───┘
                     │
                     ▼ (com aprovação)
                  ┌──────┐
                  │ AUTO │
                  └──────┘

Qualquer modo pode voltar para CHAT.
PLAN → ACT requer plano aprovado.
ACT → AUTO requer aprovação do usuário.
```

## Indicação Visual

O modo atual DEVE estar sempre visível no terminal:

```
[💬 CHAT] > _                  ← modo CHAT
[📋 PLAN] > _                  ← modo PLAN
[⚡ ACT]  > _                  ← modo ACT
[🔄 AUTO] iteração 3/10 > _   ← modo AUTO com progresso
[🔍 RESEARCH] > _             ← modo RESEARCH
```
