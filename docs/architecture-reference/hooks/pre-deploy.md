# Hook: pre-deploy

## Evento
`pre-deploy` — dispara antes de qualquer ação de deploy.

## Ação
`block` — bloqueia deploy sem checklist aprovada e sem aprovação humana.

## Objetivo
Garantir que nenhum deploy aconteça sem passar pela checklist de release e sem aprovação explícita do usuário.

## Implementação

```typescript
interface PreDeployHook {
  event: 'pre-deploy';
  handler(context: {
    environment: string;
    command: string;
    session: SessionMemory;
  }): Promise<HookResult>;
}

// Padrões que indicam deploy
const DEPLOY_PATTERNS: RegExp[] = [
  /npm\s+run\s+deploy/,
  /vercel\s+(deploy|--prod)/,
  /netlify\s+deploy/,
  /fly\s+deploy/,
  /railway\s+(up|deploy)/,
  /heroku\s+.*push/,
  /docker\s+push/,
  /kubectl\s+apply/,
  /terraform\s+apply/,
  /aws\s+.*deploy/,
  /gcloud\s+.*deploy/,
  /firebase\s+deploy/,
  /surge\s+/,
  /gh-pages/,
];

async function preDeployHook(context: {
  environment: string;
  command: string;
  session: SessionMemory;
}): Promise<HookResult> {
  const { command, session } = context;

  // 1. Verificar se o comando é de deploy
  const isDeploy = DEPLOY_PATTERNS.some(p => p.test(command));
  if (!isDeploy) return { action: 'allow' };

  // 2. Verificar se checklist foi executada
  const checklistRan = session.taskStack.some(
    t => t.skill === 'release-deploy-checklist' && t.status === 'completed'
  );

  if (!checklistRan) {
    return {
      action: 'block',
      reason: 'Deploy bloqueado: checklist de release não foi executada.',
      suggestion: 'Execute /skill release-deploy-checklist antes de deploy.',
    };
  }

  // 3. Verificar se checklist passou
  const checklistResult = session.lastChecklistResult;
  if (checklistResult && !checklistResult.passed) {
    return {
      action: 'block',
      reason: `Deploy bloqueado: checklist tem ${checklistResult.blockers.length} blocker(s).`,
      suggestion: 'Resolva os blockers antes de deploy:\n' +
        checklistResult.blockers.map(b => `  - ${b}`).join('\n'),
    };
  }

  // 4. Exigir aprovação humana
  return {
    action: 'warn',
    reason: `Deploy para ${context.environment} requer aprovação.`,
    suggestion: 'Confirme para prosseguir com o deploy.',
    requiresApproval: true,
  };
}
```

## Comportamento

### Deploy sem checklist:
```
[⊘ BLOQUEADO] Deploy bloqueado
Motivo: Checklist de release não foi executada.
Ação: Execute /skill release-deploy-checklist antes de deploy.
```

### Deploy com checklist com blockers:
```
[⊘ BLOQUEADO] Deploy bloqueado
Motivo: Checklist tem 2 blockers:
  - Testes falhando (3 testes)
  - Variável DATABASE_URL não definida
Ação: Resolva os blockers e rode a checklist novamente.
```

### Deploy com checklist OK:
```
[⚠ APROVAÇÃO] Deploy para production
Checklist: ✓ Aprovada
Confirme para prosseguir: [s/N]
```

## Configuração

```json
{
  "pre-deploy": {
    "requireChecklist": true,
    "requireApproval": true,
    "environments": {
      "production": {
        "requireChecklist": true,
        "requireApproval": true
      },
      "staging": {
        "requireChecklist": true,
        "requireApproval": false
      },
      "development": {
        "requireChecklist": false,
        "requireApproval": false
      }
    }
  }
}
```
