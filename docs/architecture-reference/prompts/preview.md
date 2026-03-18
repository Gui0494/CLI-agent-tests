# Prompt — Preview Real

## Objetivo

Implementar preview real de projetos no terminal. O agent sobe um servidor de desenvolvimento de fato e exibe a URL. Nunca finge preview.

## Princípio Fundamental

```
PREVIEW = SERVIDOR REAL RODANDO + URL ACESSÍVEL

Se não conseguir subir o servidor → declarar falha.
Se não detectar o tipo de projeto → perguntar ao usuário.
Se a porta estiver em uso → tentar outra porta.
NUNCA mostrar preview falso.
```

## Detecção de Projeto

```typescript
interface ProjectDetector {
  detect(workspacePath: string): Promise<ProjectType>;
}

interface ProjectType {
  framework: string;          // react, next, vue, svelte, static, python, etc.
  devCommand: string;         // comando para subir dev server
  buildCommand: string;       // comando para build
  defaultPort: number;        // porta padrão do dev server
  hasDevServer: boolean;      // tem dev server built-in?
}

const DETECTION_RULES: DetectionRule[] = [
  {
    // Next.js
    check: (pkg) => pkg.dependencies?.['next'] || pkg.devDependencies?.['next'],
    result: {
      framework: 'next',
      devCommand: 'npx next dev',
      buildCommand: 'npx next build',
      defaultPort: 3000,
      hasDevServer: true,
    }
  },
  {
    // Vite (React, Vue, Svelte)
    check: (pkg) => pkg.devDependencies?.['vite'],
    result: {
      framework: 'vite',
      devCommand: 'npx vite --port {{PORT}}',
      buildCommand: 'npx vite build',
      defaultPort: 5173,
      hasDevServer: true,
    }
  },
  {
    // Create React App
    check: (pkg) => pkg.dependencies?.['react-scripts'],
    result: {
      framework: 'cra',
      devCommand: 'npx react-scripts start',
      buildCommand: 'npx react-scripts build',
      defaultPort: 3000,
      hasDevServer: true,
    }
  },
  {
    // HTML estático
    check: (_, files) => files.includes('index.html') && !files.includes('package.json'),
    result: {
      framework: 'static',
      devCommand: 'npx serve .',
      buildCommand: '',  // não precisa de build
      defaultPort: 3000,
      hasDevServer: false,  // precisa de server externo
    }
  },
  {
    // Python (Flask/Django/FastAPI)
    check: (_, files) => files.includes('requirements.txt') || files.includes('pyproject.toml'),
    result: {
      framework: 'python',
      devCommand: 'python -m http.server {{PORT}}',  // fallback
      buildCommand: '',
      defaultPort: 8000,
      hasDevServer: false,
    }
  },
  {
    // Jogos HTML5 / Canvas
    check: (_, files, content) => {
      const indexHtml = content['index.html'];
      return indexHtml && (indexHtml.includes('<canvas') || indexHtml.includes('game'));
    },
    result: {
      framework: 'html5-game',
      devCommand: 'npx serve .',
      buildCommand: '',
      defaultPort: 3000,
      hasDevServer: false,
    }
  },
];
```

## Fluxo de Preview

```
USUÁRIO PEDE PREVIEW (/preview ou automático após implementação)
    │
    ▼
DETECTAR TIPO DE PROJETO
    │
    ├── Detectado → usa config do framework
    └── Não detectado → pergunta ao usuário:
         "Não detectei o tipo de projeto. Qual comando sobe o dev server?"
    │
    ▼
DETECTAR PACKAGE MANAGER (para projetos Node)
    │
    ├── package-lock.json existe? → npm
    ├── pnpm-lock.yaml existe? → pnpm
    ├── yarn.lock existe? → yarn
    ├── bun.lockb existe? → bun
    └── Nenhum lockfile? → usar npm como fallback
    │
    ▼
VERIFICAR DEPENDÊNCIAS
    │
    ├── node_modules existe? (para projetos Node)
    │   └── NÃO → PEDIR APROVAÇÃO antes de instalar:
    │        "Dependências não instaladas. Executar [npm/pnpm/yarn] install?
    │         Isso pode demorar e modificar package-lock.json.
    │         Classe de permissão: install. [Aprovar/Negar]"
    ├── Comando do dev server está disponível?
    │   └── NÃO → informar o que falta
    │
    ▼
VERIFICAR PORTA
    │
    ├── Porta padrão livre? → usar
    └── Porta ocupada? → tentar próxima (incrementar)
         └── 5 portas ocupadas? → reportar ao usuário
    │
    ▼
SUBIR SERVIDOR
    │
    ├── Executar devCommand como processo background
    ├── Capturar PID para cleanup posterior
    ├── Aguardar servidor ficar pronto (polling na porta)
    │   └── Timeout 30s → reportar falha
    │
    ▼
EXIBIR NO TERMINAL
    │
    ├── URL do preview
    ├── Atalho para abrir no browser
    ├── Atalho para parar o preview
    │
    ▼
AGUARDAR AÇÃO DO USUÁRIO
    │
    ├── Usuário abre no browser → continua rodando
    ├── Usuário pede stop → mata processo (PID)
    └── Usuário sai do agent → mata processo (PID)
```

## Implementação do Preview Server

```typescript
// Usar execa em vez de child_process.spawn para parsing robusto de comandos,
// tratamento de erros e compatibilidade cross-platform.
import { execa, ExecaChildProcess } from 'execa';
import net from 'net';
import http from 'http';

class PreviewManager {
  private activeProcess: ExecaChildProcess | null = null;
  private activePort: number | null = null;

  async start(projectType: ProjectType): Promise<PreviewResult> {
    // 1. Encontrar porta livre
    const port = await this.findFreePort(projectType.defaultPort);

    // 2. Montar comando (substituir porta)
    const command = projectType.devCommand.replace('{{PORT}}', String(port));

    // 3. Subir processo usando execa (parsing seguro, sem split(' ') frágil)
    this.activeProcess = execa({
      shell: true,       // permite comandos com pipe, &&, etc.
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
      // cleanup automático se o parent morrer
      cleanup: true,
    })`${command}`;

    // 4. Capturar output
    let stdout = '';
    let stderr = '';
    this.activeProcess.stdout?.on('data', (d) => stdout += d.toString());
    this.activeProcess.stderr?.on('data', (d) => stderr += d.toString());

    // 5. Aguardar servidor ficar pronto
    // Fase 1: porta aberta (processo aceitando conexões)
    const portOpen = await this.waitForPort(port, 30_000);

    if (!portOpen) {
      this.stop();
      return {
        success: false,
        error: `Servidor não respondeu na porta ${port} após 30s.\nstdout: ${stdout}\nstderr: ${stderr}`,
      };
    }

    // Fase 2: healthcheck HTTP (app realmente respondendo, não só porta aberta)
    const httpReady = await this.waitForHTTP(port, 15_000);

    if (!httpReady) {
      // Porta abriu mas HTTP não responde — pode ser que o app
      // ainda está compilando. Avisar mas não matar.
      console.log(chalk.yellow(
        '⚠ Servidor aceitando conexões mas HTTP não responde ainda.\n' +
        '  O app pode estar compilando. URL disponível mas pode não estar pronto.'
      ));
    }

    this.activePort = port;

    return {
      success: true,
      url: `http://localhost:${port}`,
      pid: this.activeProcess.pid!,
      port,
      httpReady,  // indica se o healthcheck HTTP passou
    };
  }

  async stop(): Promise<void> {
    if (this.activeProcess) {
      // Cross-platform: execa.kill() lida com Windows vs Unix
      this.activeProcess.kill('SIGTERM');
      // Fallback se SIGTERM não funcionar
      setTimeout(() => {
        if (this.activeProcess && !this.activeProcess.killed) {
          this.activeProcess.kill('SIGKILL');
        }
      }, 5000);
      this.activeProcess = null;
      this.activePort = null;
    }
  }

  private async findFreePort(startPort: number): Promise<number> {
    for (let port = startPort; port < startPort + 100; port++) {
      const free = await this.isPortFree(port);
      if (free) return port;
    }
    throw new Error(`Nenhuma porta livre encontrada entre ${startPort} e ${startPort + 99}`);
  }

  private isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      server.listen(port);
    });
  }

  private async waitForPort(port: number, timeout: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const connected = await this.tryConnect(port);
      if (connected) return true;
      await new Promise(r => setTimeout(r, 500));
    }
    return false;
  }

  // Healthcheck HTTP real: não basta a porta estar aberta,
  // o servidor precisa responder HTTP 200 (ou qualquer 2xx/3xx)
  private async waitForHTTP(port: number, timeout: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const ok = await this.tryHTTP(port);
      if (ok) return true;
      await new Promise(r => setTimeout(r, 1000));
    }
    return false;
  }

  private tryHTTP(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(`http://localhost:${port}/`, (res) => {
        // Qualquer resposta HTTP (mesmo 404) significa que o server está respondendo
        resolve(res.statusCode !== undefined);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(3000, () => { req.destroy(); resolve(false); });
    });
  }

  private tryConnect(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
      socket.connect(port, 'localhost');
    });
  }
}
```

## Exibição no Terminal

```typescript
function renderPreviewPanel(result: PreviewResult): void {
  if (!result.success) {
    console.log(chalk.red('✗ Preview falhou'));
    console.log(chalk.gray(result.error));
    return;
  }

  const panel = boxify('PREVIEW', [
    '',
    chalk.green('  ✓ Servidor rodando'),
    '',
    chalk.bold(`  URL: ${chalk.cyan(result.url)}`),
    chalk.gray(`  PID: ${result.pid}`),
    chalk.gray(`  Porta: ${result.port}`),
    '',
    chalk.dim('  [o] Abrir no browser  [s] Parar servidor'),
    '',
  ].join('\n'));

  console.log(panel);
}
```

## Cleanup

```typescript
// Garantir que o processo morra quando o agent sair
process.on('exit', () => {
  previewManager.stop();
});

process.on('SIGINT', () => {
  previewManager.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  previewManager.stop();
  process.exit(0);
});

// Também ao trocar de modo ou iniciar nova tarefa
function onModeChange(newMode: Mode): void {
  if (newMode !== 'ACT' && newMode !== 'AUTO') {
    previewManager.stop();
  }
}
```

## Regras Invioláveis de Preview

1. **NUNCA mostrar URL sem servidor rodando.** Se o servidor não subiu, não exiba URL.
2. **NUNCA simular preview.** Sem "aqui está como ficaria" sem servidor real.
3. **Sempre fazer cleanup.** O processo do servidor DEVE morrer quando o preview é encerrado.
4. **Sempre verificar porta.** Não assumir que a porta está livre.
5. **Sempre informar falha.** Se não conseguiu subir, diga por quê.
6. **Detectar antes de subir.** Não tentar `npm start` em projeto Python.
