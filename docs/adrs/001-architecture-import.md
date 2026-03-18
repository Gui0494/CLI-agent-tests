# ADR-001: Architecture Import as Read-Only Reference

## Status
Accepted

## Date
2026-03-14

## Context
O projeto AurexAI precisa ser alinhado com uma arquitetura de referência completa (37 arquivos). A questão é como integrar essa referência sem criar drift entre documentação e implementação.

## Decision
Copiar todos os 37 arquivos de arquitetura para `docs/architecture-reference/` como referência versionada e read-only. Criar `docs/implementation-map.md` para rastrear o mapeamento referência → implementação.

## Consequences
- **Positivo:** Documentação vira contrato, elimina drift por memória
- **Positivo:** Desvios são registrados explicitamente em ADRs
- **Positivo:** Implementação pode ser verificada contra a referência
- **Negativo:** 37 arquivos adicionais no repo (aceitável — são docs)
