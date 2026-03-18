# Prompt — Fluxo de Aprovação Padronizado

## Objetivo

Definir um contrato visual e funcional único para toda aprovação no terminal. Toda ação que requer confirmação do usuário DEVE seguir este formato.

## Regra Fundamental

Toda aprovação DEVE mostrar:
1. **Ação** — o que vai acontecer.
2. **Detalhe** — comando exato, arquivo, ou operação específica.
3. **Arquivos afetados** — quais arquivos serão modificados (se aplicável).
4. **Nível de risco** — low, medium, high, critical.
5. **Classe de permissão** — de `specs/contracts.md` seção 5.
6. **Opções de escopo** — por quanto tempo a aprovação vale.

## Contrato Visual

```typescript
interface ApprovalPrompt {
  action: string;              // "Executar comando shell"
  detail: string;              // "npm install react@19"
  filesAffected: string[];     // ["package.json", "package-lock.json"]
  riskLevel: RiskLevel;
  permissionClass: PermissionClass;
}

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
```

### Renderização

```
┌─ APROVAÇÃO ──────────────────────────────────────────┐
│                                                      │
│  Ação:    Instalar dependência                       │
│  Comando: npm install react@19 react-dom@19          │
│  Arquivos: package.json, package-lock.json           │
│  Risco:   ■■□□ médio                                 │
│  Classe:  install                                    │
│                                                      │
│  [1] Aprovar uma vez                                 │
│  [2] Aprovar nesta tarefa                            │
│  [3] Aprovar nesta sessão                            │
│  [n] Negar                                           │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Indicador de Risco

```typescript
const RISK_INDICATORS: Record<RiskLevel, { bar: string; color: string; label: string }> = {
  low:      { bar: '■□□□', color: 'green',   label: 'baixo' },
  medium:   { bar: '■■□□', color: 'yellow',  label: 'médio' },
  high:     { bar: '■■■□', color: 'red',     label: 'alto' },
  critical: { bar: '■■■■', color: 'bgRed',   label: 'CRÍTICO' },
};
```

### Classificação de Risco por Classe de Permissão

```typescript
const PERMISSION_RISK_MAP: Record<PermissionClass, RiskLevel> = {
  'read':          'low',
  'write-local':   'low',
  'shell-safe':    'low',
  'shell-unsafe':  'high',
  'git-local':     'low',
  'git-remote':    'medium',
  'network':       'low',
  'install':       'medium',
  'preview':       'low',
  'deploy':        'critical',
  'publish':       'critical',
  'db-write':      'high',
};
```

## Escopos de Aprovação

```typescript
enum ApprovalScope {
  ONCE         = 'once',          // apenas esta ação específica
  THIS_TASK    = 'this-task',     // todas as ações da mesma classe nesta tarefa
  THIS_SESSION = 'this-session',  // todas as ações da mesma classe nesta sessão
  // NOTA: "always" (permanente) não está implementado em v1
  // para evitar aprovações esquecidas que se tornam risco
}
```

### Comportamento por escopo

| Escopo | Duração | Abrangência | Exemplo |
|---|---|---|---|
| Uma vez | Esta ação apenas | Apenas este comando/arquivo | Aprovar `npm install react@19` |
| Nesta tarefa | Até a tarefa terminar | Todas as ações da mesma classe | Todas as edições de arquivo nesta tarefa |
| Nesta sessão | Até fechar o agent | Todas as ações da mesma classe | Todas as edições de arquivo nesta sessão |

### Memória de aprovações

```typescript
interface ApprovalMemory {
  // Aprovações ativas nesta sessão
  active: Map<PermissionClass, ApprovalScope>;

  // Verifica se uma ação já tem aprovação
  isApproved(permClass: PermissionClass, taskId: string): boolean;

  // Registra aprovação
  approve(permClass: PermissionClass, scope: ApprovalScope, taskId: string): void;

  // Limpa aprovações de uma tarefa (quando tarefa termina)
  clearTask(taskId: string): void;

  // Limpa tudo (quando sessão termina)
  clearAll(): void;
}
```

## Casos Especiais

### Deploy (critical)

Deploy SEMPRE mostra painel expandido:

```
┌─ ⚠ APROVAÇÃO CRÍTICA ───────────────────────────────┐
│                                                      │
│  Ação:        DEPLOY para produção                   │
│  Comando:     vercel --prod                          │
│  Ambiente:    production                             │
│  Risco:       ■■■■ CRÍTICO                           │
│  Classe:      deploy                                 │
│                                                      │
│  Checklist:   ✓ Completa (ver /skill release-deploy) │
│  Testes:      ✓ 142 passed                           │
│  Security:    ✓ 0 findings                           │
│                                                      │
│  [1] Aprovar (apenas uma vez — deploy não permite    │
│      aprovação em lote)                              │
│  [n] Negar                                           │
│                                                      │
│  NOTA: Deploy não pode ser aprovado em lote.         │
│  Cada deploy requer aprovação individual.            │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Shell inseguro (high)

```
┌─ APROVAÇÃO ──────────────────────────────────────────┐
│                                                      │
│  Ação:    Executar comando shell                     │
│  Comando: rm -rf node_modules                        │
│  Risco:   ■■■□ alto                                  │
│  Classe:  shell-unsafe                               │
│                                                      │
│  ⚠ Este comando é classificado como shell-unsafe     │
│  porque corresponde ao padrão: rm recursivo           │
│                                                      │
│  [1] Aprovar uma vez                                 │
│  [2] Aprovar nesta tarefa                            │
│  [n] Negar                                           │
│                                                      │
│  NOTA: shell-unsafe não permite aprovação de sessão. │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Restrições por risco

```typescript
const SCOPE_RESTRICTIONS: Record<RiskLevel, ApprovalScope[]> = {
  low:      ['once', 'this-task', 'this-session'],  // todas as opções
  medium:   ['once', 'this-task', 'this-session'],  // todas as opções
  high:     ['once', 'this-task'],                   // sem sessão
  critical: ['once'],                                 // apenas uma vez
};
```

## Antipadrões — PROIBIDO

```
❌ "Executar npm install? [s/N]"
   → Falta: detalhe do comando, arquivos afetados, risco, escopo.

❌ Aprovar sem mostrar o comando exato
   → O usuário deve ver exatamente o que será executado.

❌ Aprovação silenciosa (sem mostrar nada)
   → Toda aprovação deve renderizar o painel completo.

❌ Aprovação permanente para ações de alto risco
   → deploy e publish NUNCA podem ser aprovados permanentemente.
```

## Implementação

```typescript
async function requestApproval(request: ApprovalPrompt): Promise<ApprovalResult> {
  // 1. Verificar se já tem aprovação ativa
  const existing = approvalMemory.isApproved(request.permissionClass, currentTaskId);
  if (existing) return { approved: true, scope: existing };

  // 2. Determinar opções de escopo disponíveis
  const risk = PERMISSION_RISK_MAP[request.permissionClass];
  const availableScopes = SCOPE_RESTRICTIONS[risk];

  // 3. Renderizar painel de aprovação
  renderApprovalPanel(request, risk, availableScopes);

  // 4. Aguardar input do usuário
  const choice = await waitForUserInput(availableScopes);

  if (choice === 'deny') {
    return { approved: false };
  }

  // 5. Registrar aprovação
  approvalMemory.approve(request.permissionClass, choice, currentTaskId);

  return { approved: true, scope: choice };
}
```
