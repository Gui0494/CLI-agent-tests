# Skill: release-deploy-checklist

## Objetivo
Confere env vars, migrações, build, rollback, healthcheck e observabilidade antes de deploy.

## Quando Usar
- Antes de qualquer deploy para produção.
- Quando o usuário pede para preparar release.
- Automaticamente via hook pre-deploy.

## Trigger
```yaml
manual: true        # /skill release-deploy-checklist
auto: true
patterns:
  - "deploy"
  - "release"
  - "produção"
  - "production"
```

## Entradas
| Input | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| environment | string | não | "production", "staging" (padrão: "production") |

## Saídas
| Output | Tipo | Descrição |
|---|---|---|
| checklist | ChecklistItem[] | Items verificados |
| passed | boolean | Se todos os items críticos passaram |
| blockers | string[] | Items que bloqueiam o deploy |

## Ferramentas Necessárias
- `fs_read` — ler configs e .env
- `shell` — rodar build e testes
- `fs_grep` — buscar variáveis de ambiente
- MCP `cicd` — verificar pipeline (se disponível)

## Fluxo

```
1. VARIÁVEIS DE AMBIENTE
   ├── Ler .env.example e comparar com .env.production
   ├── Verificar se todas as vars obrigatórias estão definidas
   └── ⚠ Alertar vars faltantes

2. BUILD
   ├── Rodar build de produção
   ├── Verificar se build passou sem erros
   └── ⚠ Alertar warnings críticos

3. TESTES
   ├── Rodar suite de testes completa
   ├── Verificar cobertura (se configurado)
   └── ⚠ Bloquear se testes falharem

4. MIGRAÇÕES
   ├── Verificar se há migrações pendentes
   ├── Confirmar que migrações são reversíveis
   └── ⚠ Alertar migrações destrutivas

5. SEGURANÇA
   ├── npm audit / pip audit
   ├── Verificar se não há secrets no código
   └── ⚠ Bloquear vulnerabilidades críticas

6. ROLLBACK
   ├── Verificar que rollback é possível
   ├── Documentar passos de rollback
   └── ⚠ Alertar se rollback não é trivial

7. HEALTHCHECK
   ├── Verificar se healthcheck endpoint existe
   ├── Confirmar que monitora deps críticas (DB, cache, etc.)
   └── ⚠ Alertar se não há healthcheck

8. OBSERVABILIDADE
   ├── Logs configurados?
   ├── Métricas/alertas configurados?
   └── Tracing configurado? (nice to have)

9. APROVAÇÃO
   └── Exigir aprovação humana antes de prosseguir
```

## Formato de Saída

```markdown
## Deploy Checklist — Production

### ✓ Passed
- [x] Build de produção: OK (32s)
- [x] Testes: 142 passed, 0 failed
- [x] npm audit: 0 vulnerabilidades
- [x] .env vars: todas presentes
- [x] Healthcheck: /api/health configurado

### ⚠ Warnings
- [ ] Cobertura de testes: 68% (meta: 80%)
- [ ] 1 migração pendente (reversível)

### 🔴 Blockers
- (nenhum)

### Rollback Plan
1. git revert ao commit anterior
2. Deploy da versão N-1
3. Reverter migração: `npx prisma migrate reset --to <migration_id>`

### Status: ✓ PRONTO PARA DEPLOY
Aguardando aprovação humana.
```

## Limites
- Não executa o deploy em si (apenas verifica pré-requisitos).
- Requer aprovação humana para prosseguir.
- Timeout: 300s (build pode demorar).

## Falhas Comuns
| Falha | Causa | Solução |
|---|---|---|
| Build falha | Erro de compilação | Corrigir antes de deploy |
| Var faltante | .env.example desatualizado | Atualizar .env.example |
| Sem healthcheck | Endpoint não implementado | Implementar antes de deploy |
