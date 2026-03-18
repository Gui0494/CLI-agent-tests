# Hook: pre-shell

## Evento
`pre-shell` — dispara antes de executar qualquer comando shell.

## Ação
`block` | `warn` — bloqueia comandos destrutivos, alerta sobre comandos suspeitos.

## Objetivo
Impedir que comandos destrutivos sejam executados sem aprovação explícita. Bloquear comandos que possam causar dano irreversível.

## Implementação

```typescript
interface PreShellHook {
  event: 'pre-shell';
  handler(context: { command: string; cwd: string; mode: Mode }): HookResult;
}

interface HookResult {
  action: 'allow' | 'block' | 'warn';
  reason?: string;
  suggestion?: string;
}

// Comandos BLOQUEADOS (deny — nunca executar)
// Organizados por plataforma para clareza.
const BLOCKED_PATTERNS: RegExp[] = [
  // ── Unix/Linux/macOS ──
  // Deleção destrutiva
  /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?-[a-zA-Z]*r[a-zA-Z]*\s+\//,   // rm -rf /
  /rm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?-[a-zA-Z]*f[a-zA-Z]*\s+\//,   // rm -fr /
  /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?-[a-zA-Z]*r[a-zA-Z]*\s+~/,    // rm -rf ~

  // Formatação de disco
  /mkfs\./,
  /dd\s+if=.*of=\/dev/,

  // Fork bomb e derivados
  /:\(\)\s*\{\s*:\|:&\s*\}\s*;:/,
  /\.\(\)\s*\{\s*\.\|\.&\s*\}\s*;\./,

  // Permissões perigosas
  /chmod\s+(-[a-zA-Z]*\s+)?777\s+\//,
  /chown\s+(-[a-zA-Z]*\s+)?root\s+\//,

  // Escrita em devices
  />\s*\/dev\/sd[a-z]/,
  />\s*\/dev\/nvme/,

  // Rede destrutiva
  /iptables\s+-F/,                                                  // flush firewall
  /ufw\s+disable/,                                                  // desabilitar firewall

  // Shutdown/reboot
  /shutdown/,
  /reboot/,
  /init\s+[06]/,

  // ── Windows (CMD) ──
  /del\s+\/[fF]\s+\/[qQ]/,                                         // del /f /q
  /rd\s+\/[sS]\s+\/[qQ]/,                                          // rd /s /q (recursive delete)
  /format\s+[a-zA-Z]:/i,                                           // format C:
  /diskpart/i,                                                      // disk partitioning

  // ── Windows (PowerShell) ──
  /Remove-Item\s+.*-Recurse\s+.*-Force/i,                          // Remove-Item -Recurse -Force
  /Remove-Item\s+.*-Force\s+.*-Recurse/i,                          // ordem invertida
  /Clear-Disk/i,                                                    // limpar disco
  /Stop-Computer/i,                                                 // shutdown
  /Restart-Computer/i,                                              // reboot
  /Format-Volume/i,                                                 // formatar volume
];

// Comandos que geram WARNING (ask — pedir confirmação)
const WARN_PATTERNS: RegExp[] = [
  // ── Unix/Linux/macOS ──
  /rm\s+-[a-zA-Z]*r/,          // rm recursivo (qualquer, não só /)
  /sudo\s+/,                   // qualquer comando com sudo
  /curl.*\|\s*(ba)?sh/,        // curl pipe to bash

  // ── Git (cross-platform) ──
  /git\s+push\s+.*--force/,    // force push
  /git\s+reset\s+--hard/,      // reset hard
  /git\s+clean\s+-[a-zA-Z]*f/, // git clean force

  // ── Package managers (cross-platform) ──
  /npm\s+publish/,              // publicar pacote
  /npx\s+/,                    // executar pacote remoto

  // ── Docker (cross-platform) ──
  /docker\s+system\s+prune/,   // limpar docker

  // ── SQL (cross-platform) ──
  /drop\s+table/i,             // SQL drop
  /drop\s+database/i,          // SQL drop database
  /truncate\s+table/i,         // SQL truncate

  // ── Windows (PowerShell) ──
  /Remove-Item\s+.*-Recurse/i, // Remove-Item recursivo (sem -Force, warn em vez de block)
  /Set-ExecutionPolicy/i,      // mudar política de execução
];

function preShellHook(context: { command: string; cwd: string; mode: Mode }): HookResult {
  const { command } = context;

  // Verificar blocklist
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return {
        action: 'block',
        reason: `Comando bloqueado por segurança: "${command}" corresponde a padrão destrutivo.`,
        suggestion: 'Este tipo de comando não pode ser executado pelo agent.',
      };
    }
  }

  // Verificar warn list
  for (const pattern of WARN_PATTERNS) {
    if (pattern.test(command)) {
      return {
        action: 'warn',
        reason: `Comando potencialmente perigoso: "${command}".`,
        suggestion: 'Confirme antes de executar.',
      };
    }
  }

  return { action: 'allow' };
}
```

## Comportamento

### Quando BLOCK:
```
[⊘ BLOQUEADO] Comando: rm -rf /home
Motivo: Comando corresponde a padrão destrutivo (rm recursivo em diretório raiz).
Este comando não pode ser executado pelo agent por segurança.
```

### Quando WARN:
```
[⚠ ATENÇÃO] Comando: git push --force origin main
Motivo: Force push pode sobrescrever histórico no remote.
Deseja continuar? [s/N]
```

### Quando ALLOW:
Execução silenciosa, sem mensagem extra.

## Configuração

O usuário pode customizar a blocklist e warn list via `.agent/hooks.json`:

```json
{
  "pre-shell": {
    "additionalBlocked": [
      "custom-dangerous-command"
    ],
    "additionalWarn": [
      "npm run deploy"
    ],
    "whitelist": [
      "rm -rf node_modules",
      "rm -rf dist"
    ]
  }
}
```
