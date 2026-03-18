# Hook: on-session-start (Doctor / Healthcheck)

## Evento
`on-session-start` — dispara automaticamente no início de cada sessão do agent.

## Ação
`run` — executa healthcheck de todas as ferramentas e exibe status ao usuário.

## Objetivo
Verificar a disponibilidade real de todas as ferramentas e integrações no início da sessão, para que o agent saiba o que pode e o que não pode fazer antes de tentar.

## Implementação

```typescript
interface DoctorCheck {
  name: string;
  check(): Promise<CheckResult>;
}

interface CheckResult {
  status: 'ok' | 'warning' | 'error' | 'unavailable';
  detail: string;
  fix?: string;
}

const DOCTOR_CHECKS: DoctorCheck[] = [
  {
    name: 'shell',
    async check() {
      try {
        const result = await execa('echo', ['ok']);
        return { status: 'ok', detail: 'Shell funcional' };
      } catch {
        return { status: 'error', detail: 'Shell não responsivo' };
      }
    }
  },

  {
    name: 'git',
    async check() {
      try {
        await execa('git', ['--version']);
        // Verificar se estamos em um repositório
        try {
          await execa('git', ['rev-parse', '--git-dir']);
          return { status: 'ok', detail: 'Git instalado, workspace é repositório' };
        } catch {
          return {
            status: 'warning',
            detail: 'Git instalado mas workspace não é repositório',
            fix: 'git init'
          };
        }
      } catch {
        return {
          status: 'unavailable',
          detail: 'Git não instalado',
          fix: 'Instalar git: https://git-scm.com'
        };
      }
    }
  },

  {
    name: 'node',
    async check() {
      try {
        const result = await execa('node', ['--version']);
        const version = result.stdout.trim();
        const major = parseInt(version.replace('v', ''));
        if (major < 18) {
          return {
            status: 'warning',
            detail: `Node.js ${version} (recomendado: 18+)`,
            fix: 'Atualizar Node.js: https://nodejs.org'
          };
        }
        return { status: 'ok', detail: `Node.js ${version}` };
      } catch {
        return { status: 'unavailable', detail: 'Node.js não instalado' };
      }
    }
  },

  {
    name: 'package-manager',
    async check() {
      // Detectar pelo lockfile
      if (await fileExists('pnpm-lock.yaml')) {
        return { status: 'ok', detail: 'pnpm (detectado via lockfile)' };
      }
      if (await fileExists('yarn.lock')) {
        return { status: 'ok', detail: 'yarn (detectado via lockfile)' };
      }
      if (await fileExists('bun.lockb')) {
        return { status: 'ok', detail: 'bun (detectado via lockfile)' };
      }
      if (await fileExists('package-lock.json')) {
        return { status: 'ok', detail: 'npm (detectado via lockfile)' };
      }
      if (await fileExists('package.json')) {
        return {
          status: 'warning',
          detail: 'package.json existe mas sem lockfile',
          fix: 'Rode npm install para gerar package-lock.json'
        };
      }
      return { status: 'unavailable', detail: 'Nenhum package manager detectado' };
    }
  },

  {
    name: 'web-search',
    async check() {
      // Verificar se a tool web_search está registrada e funcional
      const tool = toolRegistry.get('web_search');
      if (!tool) return { status: 'unavailable', detail: 'Tool web_search não configurada' };
      if (tool.availability === 'available') return { status: 'ok', detail: 'Pesquisa web disponível' };
      return { status: 'unavailable', detail: 'web_search configurada mas não funcional' };
    }
  },

  {
    name: 'formatter',
    async check() {
      try {
        await execa('npx', ['prettier', '--version']);
        return { status: 'ok', detail: 'Prettier disponível' };
      } catch {
        try {
          await execa('black', ['--version']);
          return { status: 'ok', detail: 'Black disponível' };
        } catch {
          return {
            status: 'warning',
            detail: 'Nenhum formatter detectado',
            fix: 'npm install -D prettier'
          };
        }
      }
    }
  },

  {
    name: 'linter',
    async check() {
      try {
        await execa('npx', ['eslint', '--version']);
        return { status: 'ok', detail: 'ESLint disponível' };
      } catch {
        return {
          status: 'warning',
          detail: 'Nenhum linter detectado',
          fix: 'npm install -D eslint'
        };
      }
    }
  },

  {
    name: 'mcp',
    async check() {
      const configuredMCPs = mcpGateway.getConfigured();
      if (configuredMCPs.length === 0) {
        return { status: 'unavailable', detail: 'Nenhum MCP configurado' };
      }
      const results = await Promise.all(
        configuredMCPs.map(async (mcp) => {
          const healthy = await mcp.healthCheck();
          return { name: mcp.name, healthy };
        })
      );
      const failed = results.filter(r => !r.healthy);
      if (failed.length > 0) {
        return {
          status: 'warning',
          detail: `${results.length - failed.length}/${results.length} MCPs online. Offline: ${failed.map(f => f.name).join(', ')}`,
        };
      }
      return { status: 'ok', detail: `${results.length} MCPs online` };
    }
  },

  {
    name: 'preview',
    async check() {
      // Verificar se o projeto tem dev server detectável
      if (!await fileExists('package.json')) {
        return { status: 'unavailable', detail: 'Sem package.json — preview não detectável' };
      }
      const pkg = JSON.parse(await readFile('package.json'));
      const hasDevScript = pkg.scripts?.dev || pkg.scripts?.start;
      if (hasDevScript) {
        return { status: 'ok', detail: `Preview disponível via: ${pkg.scripts.dev ? 'npm run dev' : 'npm start'}` };
      }
      return { status: 'warning', detail: 'Sem script dev/start no package.json' };
    }
  },

  {
    name: 'platform',
    async check() {
      const os = process.platform;
      const shell = process.env.SHELL || process.env.ComSpec || 'unknown';
      const isWSL = await fileExists('/proc/version')
        && (await readFile('/proc/version')).toLowerCase().includes('microsoft');
      return {
        status: 'ok',
        detail: `${os} | shell: ${path.basename(shell)}${isWSL ? ' (WSL)' : ''}`,
      };
    }
  },
];
```

## Renderização no Terminal

```
┌─ DOCTOR ─────────────────────────────────────────┐
│                                                  │
│  ✓ shell       Shell funcional                   │
│  ✓ git         Git instalado, workspace é repo   │
│  ✓ node        Node.js v20.11.0                  │
│  ✓ pkg-manager npm (detectado via lockfile)       │
│  ✗ web-search  Tool web_search não configurada   │
│  ✓ formatter   Prettier disponível               │
│  ✓ linter      ESLint disponível                 │
│  ⚠ mcp         1/2 MCPs online. Offline: docs    │
│  ✓ preview     Preview disponível via npm run dev │
│  ✓ platform    linux | shell: bash               │
│                                                  │
│  Status: ⚠ DEGRADADO                            │
│  web-search indisponível: skill current-docs     │
│  operará com limitações. Pesquisa web não será   │
│  possível.                                       │
│                                                  │
└──────────────────────────────────────────────────┘
```

## Invocação Manual

```
> /doctor
```

Executa o healthcheck a qualquer momento, não só no início da sessão.

## Impacto no Agent

O resultado do doctor é salvo no `sessionMemory.doctorResult` e usado para:

1. **Classificar tool availability** — tools marcadas como `unavailable` pelo doctor não são oferecidas ao LLM.
2. **Ativar/desativar skills** — se `web-search` está indisponível, `current-docs` opera em modo bloqueante (não faz fallback).
3. **Ajustar prompts** — o system prompt inclui quais tools estão disponíveis e quais não.
4. **Informar o usuário proativamente** — se algo crítico está faltando, o agent avisa antes de começar.

## Configuração

```json
{
  "on-session-start": {
    "runDoctor": true,
    "skipChecks": [],
    "failOnError": false,
    "verbose": false
  }
}
```
