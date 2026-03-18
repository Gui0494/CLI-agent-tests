/**
 * modes.ts — Mode system for AurexAI CLI Agent
 *
 * Defines 5 operational modes (CHAT, PLAN, ACT, AUTO, RESEARCH),
 * valid transitions, transition guards, and per-mode configuration.
 *
 * Reference: docs/architecture-reference/specs/contracts.md §1
 * Reference: docs/architecture-reference/prompts/modes.md
 */

import { EventEmitter } from "events";

// ─── Enums ───────────────────────────────────────────────

export enum Mode {
  CHAT     = 'CHAT',
  PLAN     = 'PLAN',
  ACT      = 'ACT',
  AUTO     = 'AUTO',
  RESEARCH = 'RESEARCH',
}

// ─── Transitions ─────────────────────────────────────────

export const VALID_TRANSITIONS: Record<Mode, Mode[]> = {
  [Mode.CHAT]:     [Mode.PLAN, Mode.ACT, Mode.RESEARCH, Mode.AUTO],
  [Mode.PLAN]:     [Mode.CHAT, Mode.ACT, Mode.RESEARCH],
  [Mode.ACT]:      [Mode.CHAT, Mode.PLAN, Mode.RESEARCH, Mode.AUTO],
  [Mode.AUTO]:     [Mode.CHAT, Mode.PLAN],
  [Mode.RESEARCH]: [Mode.CHAT, Mode.PLAN, Mode.ACT],
};

// ─── Mode Configs ────────────────────────────────────────

export interface ModeConfig {
  allowedTools: string[];
  blockedTools: string[];
  systemPromptAddition: string;
  requiresApproval?: boolean;
  enableAutoCorrection?: boolean;
  maxRetries?: number;
  maxIterations?: number;
  requiresInitialApproval?: boolean;
  pauseOnAmbiguity?: boolean;
}

export const CHAT_CONFIG: ModeConfig = {
  allowedTools: ['fs_read', 'fs_glob', 'fs_grep'],
  blockedTools: ['shell', 'fs_write', 'fs_create', 'git_add', 'git_commit', 'git_branch', 'git_push', 'git_pull', 'preview', 'deploy', 'npm_install', 'npm_publish'],
  systemPromptAddition: `
    Você está em modo CHAT. Pode conversar livremente e ler arquivos.
    NÃO execute comandos, NÃO edite arquivos, NÃO faça git operations.
    Se o usuário pedir ação que modifica algo, responda:
    "Para executar essa ação, mude para modo ACT com /mode act."
  `,
};

export const PLAN_CONFIG: ModeConfig = {
  allowedTools: ['fs_read', 'fs_glob', 'fs_grep', 'web_search', 'web_fetch'],
  blockedTools: ['shell', 'fs_write', 'fs_create', 'git_add', 'git_commit', 'git_branch', 'git_push', 'git_pull', 'preview', 'deploy', 'npm_install', 'npm_publish'],
  systemPromptAddition: `
    Você está em modo PLAN. Sua tarefa é gerar um plano estruturado.

    Formato obrigatório do plano:

    ## Objetivo
    [Uma frase descrevendo o objetivo]

    ## Arquivos Afetados
    - path/to/file.ts — [o que muda]

    ## Riscos
    - [risco e como mitigar]

    ## Passos
    1. [ ] [descrição do passo]
       - Tools: [tools necessárias]
       - Dependências: [passos que precisam estar completos]

    ## Critérios de Aceite
    - [ ] [critério mensurável]

    NÃO execute NENHUMA ação. Apenas planeje.
    O plano será revisado pelo usuário antes de executar.
  `,
  requiresApproval: true,
};

export const ACT_CONFIG: ModeConfig = {
  allowedTools: ['*'],
  blockedTools: [],
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
  enableAutoCorrection: true,
  maxRetries: 3,
};

export const AUTO_CONFIG: ModeConfig = {
  allowedTools: ['*'],
  blockedTools: [],
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
    - Atingiu o máximo de iterações.
    - Erro fatal (OOM, disco cheio, permissão root).
    - Encontrou decisão ambígua que precisa de input do usuário.
  `,
  requiresInitialApproval: true,
  maxIterations: 10,
  enableAutoCorrection: true,
  maxRetries: 3,
  pauseOnAmbiguity: true,
};

export const RESEARCH_CONFIG: ModeConfig = {
  allowedTools: ['fs_read', 'fs_glob', 'fs_grep', 'web_search', 'web_fetch'],
  blockedTools: ['shell', 'fs_write', 'fs_create', 'git_add', 'git_commit', 'git_branch', 'git_push', 'git_pull', 'preview', 'deploy', 'npm_install', 'npm_publish'],
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
    - [URL] — [resumo]

    ### Descobertas
    [informação estruturada]

    ### Relevância para o Projeto
    [como isso se aplica ao contexto atual]
  `,
};

export const MODE_CONFIGS: Record<Mode, ModeConfig> = {
  [Mode.CHAT]: CHAT_CONFIG,
  [Mode.PLAN]: PLAN_CONFIG,
  [Mode.ACT]: ACT_CONFIG,
  [Mode.AUTO]: AUTO_CONFIG,
  [Mode.RESEARCH]: RESEARCH_CONFIG,
};

// ─── Mode Emoji Map ──────────────────────────────────────

export const MODE_EMOJI: Record<Mode, string> = {
  [Mode.CHAT]:     '💬',
  [Mode.PLAN]:     '📋',
  [Mode.ACT]:      '⚡',
  [Mode.AUTO]:     '🔄',
  [Mode.RESEARCH]: '🔍',
};

// ─── ModeManager ─────────────────────────────────────────

export interface ModeChangeEvent {
  from: Mode;
  to: Mode;
  timestamp: number;
}

export class ModeManager extends EventEmitter {
  private currentMode: Mode = Mode.CHAT;
  private modeHistory: Mode[] = [];
  private approvedPlan: boolean = false;

  /**
   * Callback invoked when AUTO mode requires user confirmation.
   * Must be injected by the REPL or whoever creates ModeManager.
   */
  private confirmFn: ((message: string) => Promise<boolean>) | null = null;

  setConfirmFunction(fn: (message: string) => Promise<boolean>): void {
    this.confirmFn = fn;
  }

  getMode(): Mode {
    return this.currentMode;
  }

  getConfig(): ModeConfig {
    return MODE_CONFIGS[this.currentMode];
  }

  getEmoji(): string {
    return MODE_EMOJI[this.currentMode];
  }

  getHistory(): Mode[] {
    return [...this.modeHistory];
  }

  setApprovedPlan(approved: boolean): void {
    this.approvedPlan = approved;
  }

  hasApprovedPlan(): boolean {
    return this.approvedPlan;
  }

  /**
   * Switch to a new mode with validation of transitions and guards.
   * Throws if transition is invalid or guard conditions are not met.
   */
  async switch(newMode: Mode): Promise<void> {
    const from = this.currentMode;

    if (from === newMode) return; // no-op

    // Validate transition
    if (!this.isValidTransition(from, newMode)) {
      throw new Error(
        `Transição ${from} → ${newMode} não permitida. ` +
        `Transições válidas de ${from}: ${VALID_TRANSITIONS[from].join(', ')}`
      );
    }

    // Guard: PLAN → ACT requires approved plan
    if (from === Mode.PLAN && newMode === Mode.ACT && !this.approvedPlan) {
      throw new Error(
        'Transição PLAN → ACT requer plano aprovado pelo usuário. ' +
        'Use /approve para aprovar o plano atual.'
      );
    }

    // Guard: *→AUTO requires user confirmation
    if (newMode === Mode.AUTO) {
      if (!this.confirmFn) {
        throw new Error('Confirmação do usuário necessária para modo AUTO, mas função de confirmação não configurada.');
      }
      const confirmed = await this.confirmFn(
        'Modo AUTO executa ações automaticamente.\n' +
        'Permissões liberadas: read, write-local, shell-safe, git-local, network, preview.\n' +
        'Ações críticas (shell-unsafe, git-remote, install, deploy, publish) ainda pedirão confirmação.\n' +
        'Confirma? (s/N)'
      );
      if (!confirmed) {
        return; // User declined, stay in current mode
      }
    }

    // Execute transition
    this.modeHistory.push(from);
    this.currentMode = newMode;

    // Clear approved plan when leaving ACT/AUTO (plan was consumed)
    if (from === Mode.ACT || from === Mode.AUTO) {
      this.approvedPlan = false;
    }

    const event: ModeChangeEvent = {
      from,
      to: newMode,
      timestamp: Date.now(),
    };

    this.emit('modeChange', event);
  }

  /**
   * Check if a tool is allowed in the current mode.
   * Returns true if tool is in allowedTools (or '*') and not in blockedTools.
   */
  isToolAllowed(toolName: string): boolean {
    const config = this.getConfig();

    // Explicitly blocked
    if (config.blockedTools.includes(toolName)) {
      return false;
    }

    // Wildcard allows everything not blocked
    if (config.allowedTools.includes('*')) {
      return true;
    }

    // Must be in allowed list
    return config.allowedTools.includes(toolName);
  }

  private isValidTransition(from: Mode, to: Mode): boolean {
    return VALID_TRANSITIONS[from].includes(to);
  }
}
