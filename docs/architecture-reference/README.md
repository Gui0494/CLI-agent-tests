# Architecture Reference — Read-Only

> **⚠ Esta pasta é referência read-only.** Não edite estes arquivos.

## O que é isto?

Esta pasta contém a **arquitetura de referência** completa para o CLI Agent de produção. São 37 arquivos copiados da spec original (`prompts-e-skills-claude-cli-agent-architecture`) e versionados aqui como contrato.

## Estrutura

```
architecture-reference/
├── AGENTS.md              — Visão geral do agente
├── mcp.md                 — Model Context Protocol
├── hooks/                 — 6 definições de hooks (pre-shell, post-edit, etc.)
├── prompts/               — 8 prompts (modos, aprovação, anti-alucinação, etc.)
├── specs/                 — 6 specs (contracts, architecture, PRD, memory, etc.)
├── skills/                — 11 definições de skills
└── subagents/             — 4 definições de subagents
```

## Como usar

1. **Consulte** estes arquivos ao implementar funcionalidades
2. **Não edite** — qualquer desvio deve ser registrado em `docs/adrs/`
3. **Mapeie** a implementação em `docs/implementation-map.md`

## Fonte

Copiado de: `prompts-e-skills-claude-cli-agent-architecture-DxyBz`  
Data do import: 2026-03-14  
Versão do contrato: 1.1.0 (conforme `specs/contracts.md`)
