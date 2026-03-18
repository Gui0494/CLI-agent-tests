# Implementation Map — Arquitetura → Código

> Mapeamento de cada decisão arquitetural para o arquivo real que a implementa.  
> Atualizar este documento a cada PR.

## Legenda de Status
- `todo` — ainda não implementado
- `partial` — implementação parcial
- `done` — implementação completa
- `deferred` — adiado para fase futura

---

## Fase 1 — Core Foundation

| Arquivo Referência | Seção/Conceito | Decisão | Arquivo Implementação | Status |
|---|---|---|---|---|
| `specs/contracts.md` | §1 Enum Mode | Seguir spec (5 modos) | `src/agent/modes.ts` | todo |
| `specs/contracts.md` | §1 VALID_TRANSITIONS | Seguir spec | `src/agent/modes.ts` | todo |
| `specs/contracts.md` | §1 TRANSITION_GUARDS | Seguir spec | `src/agent/modes.ts` | todo |
| `prompts/modes.md` | ModeManager class | Adaptar ao PythonBridge existente | `src/agent/modes.ts` | todo |
| `prompts/modes.md` | CHAT_CONFIG | Seguir spec | `src/agent/modes.ts` | todo |
| `prompts/modes.md` | PLAN_CONFIG | Seguir spec | `src/agent/modes.ts` | todo |
| `prompts/modes.md` | ACT_CONFIG | Seguir spec | `src/agent/modes.ts` | todo |
| `prompts/modes.md` | AUTO_CONFIG | Seguir spec | `src/agent/modes.ts` | todo |
| `prompts/modes.md` | RESEARCH_CONFIG | Seguir spec | `src/agent/modes.ts` | todo |
| `specs/contracts.md` | §5 PermissionClass | Seguir spec (12 classes) | `src/security/permissions.ts` | todo |
| `specs/contracts.md` | §5 MODE_PERMISSION_MATRIX | Seguir spec | `src/security/permissions.ts` | todo |
| `specs/contracts.md` | §6 TOOL_PERMISSION_MAP | Seguir spec | `src/security/permissions.ts` | todo |
| `hooks/pre-shell.md` | BLOCKED_PATTERNS | Seguir spec (cross-platform) | `src/security/blocklist.ts` | todo |
| `hooks/pre-shell.md` | WARN_PATTERNS | Seguir spec (cross-platform) | `src/security/blocklist.ts` | todo |
| `hooks/workspace-sandbox.md` | Workspace boundary | Seguir spec | `src/security/sandbox.ts` | todo |
| `specs/contracts.md` | §2 HookEvent | Seguir spec | `src/hooks/engine.ts` | todo |
| `specs/contracts.md` | §2 HookAction | Seguir spec | `src/hooks/engine.ts` | todo |
| `hooks/pre-shell.md` | preShellHook | Seguir spec | `src/hooks/rules/pre-shell.ts` | todo |
| `hooks/workspace-sandbox.md` | pre-write hook | Seguir spec | `src/hooks/rules/workspace-sandbox.ts` | todo |
| `hooks/post-edit.md` | post-edit hook | Seguir spec | `src/hooks/rules/post-edit.ts` | todo |
| `specs/contracts.md` | §10 ApprovalRequest | Seguir spec | `src/cli/approval.ts` | todo |
| `prompts/approval-flow.md` | ApprovalScope | Seguir spec (sem ALWAYS em v1) | `src/cli/approval.ts` | todo |
| `prompts/approval-flow.md` | ApprovalMemory | Seguir spec | `src/agent/approval-memory.ts` | todo |
| `prompts/anti-hallucination.md` | HallucinationGuard | Seguir + ActionLedger explícito | `src/agent/action-ledger.ts` | todo |
| `prompts/anti-hallucination.md` | Regras por modo | Regras explícitas por modo | `src/agent/honesty-guard.ts` | todo |

## Fase 2 — Skills & Memory (deferred)

| Arquivo Referência | Decisão | Status |
|---|---|---|
| `specs/skill-user.md` | Implementar na Fase 2 | deferred |
| `skills/*.md` (11 arquivos) | Implementar na Fase 2 | deferred |
| `specs/memory.md` | Implementar na Fase 2 | deferred |
| `hooks/on-session-start.md` | Implementar na Fase 2 | deferred |

## Fase 3 — Subagents & Preview (deferred)

| Arquivo Referência | Decisão | Status |
|---|---|---|
| `subagents/*.md` (4 arquivos) | Implementar na Fase 3 | deferred |
| `prompts/preview.md` | Implementar na Fase 3 | deferred |

## Fase 4 — MCP & Polishing (deferred)

| Arquivo Referência | Decisão | Status |
|---|---|---|
| `mcp.md` | Implementar na Fase 4 | deferred |
| `prompts/terminal-ui.md` | Implementar na Fase 4 | deferred |
