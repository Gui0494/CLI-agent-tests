# Prompt — Interface Terminal

## Objetivo

Ensinar o agent a renderizar uma interface bonita, clara e funcional no terminal usando ANSI escape codes, spinners, painéis e syntax highlighting.

## Estrutura Visual

### Layout Principal

```
┌─────────────────────────────────────────────────────┐
│  🔵 CHAT │ projeto: meu-app │ stack: React+TS      │  ← Status bar
├─────────────────────────────────────────────────────┤
│                                                     │
│  > Usuário: Adicione dark mode ao header            │  ← Input do usuário
│                                                     │
│  ⠋ Analisando código...                            │  ← Spinner durante processamento
│                                                     │
│  Lendo src/components/Header.tsx                    │  ← Ação em andamento
│  ┌─ Header.tsx ────────────────────────────────┐    │
│  │  1 │ import { useState } from 'react'       │    │  ← Syntax highlighted
│  │  2 │ import { Moon, Sun } from 'lucide-react'│    │
│  │  3 │                                        │    │
│  │  4 │ export function Header() {             │    │
│  │  5 │   const [dark, setDark] = useState()   │    │
│  └──────────────────────────────────────────────┘    │
│                                                     │
│  ┌─ DIFF ──────────────────────────────────────┐    │
│  │  - <header className="bg-white">            │    │  ← Diff panel
│  │  + <header className={dark ? "bg-gray-900"  │    │
│  │  +   : "bg-white"}>                         │    │
│  └──────────────────────────────────────────────┘    │
│                                                     │
│  ✓ Arquivo salvo                                    │  ← Status de ação
│  ✓ Prettier executado                               │
│  ✓ ESLint: 0 erros                                  │
│                                                     │
├─────────────────────────────────────────────────────┤
│  [P]lan  [A]ct  [R]esearch  [/]help  [q]uit        │  ← Keybinds bar
└─────────────────────────────────────────────────────┘
```

### Indicador de Modo

```typescript
const MODE_INDICATORS = {
  CHAT:     { icon: '💬', color: 'blue',    label: 'CHAT' },
  PLAN:     { icon: '📋', color: 'yellow',  label: 'PLAN' },
  ACT:      { icon: '⚡', color: 'green',   label: 'ACT' },
  AUTO:     { icon: '🔄', color: 'magenta', label: 'AUTO' },
  RESEARCH: { icon: '🔍', color: 'cyan',    label: 'RESEARCH' },
};
```

### Spinner Patterns

```typescript
// Usar durante operações assíncronas
import ora from 'ora';

// Padrão para operações LLM
const thinkingSpinner = ora({
  text: 'Pensando...',
  spinner: 'dots',
  color: 'cyan',
});

// Padrão para execução de comandos
const execSpinner = ora({
  text: 'Executando...',
  spinner: 'line',
  color: 'yellow',
});

// Padrão para pesquisa web
const searchSpinner = ora({
  text: 'Pesquisando...',
  spinner: 'globe',    // se disponível, senão 'dots'
  color: 'green',
});
```

### Painéis de Código

```typescript
import chalk from 'chalk';

function renderCodePanel(filename: string, code: string, language: string): string {
  const border = chalk.gray('─'.repeat(50));
  const header = chalk.bold.white(`┌─ ${filename} ${border}`).slice(0, 54) + '┐';
  const footer = chalk.gray('└' + '─'.repeat(53) + '┘');

  // Syntax highlight via shiki
  const highlighted = highlightCode(code, language);

  // Adicionar números de linha
  const lines = highlighted.split('\n').map((line, i) => {
    const lineNum = chalk.gray(String(i + 1).padStart(3));
    return `│ ${lineNum} │ ${line}`;
  });

  return [header, ...lines, footer].join('\n');
}
```

### Painel de Diff

```typescript
function renderDiffPanel(diff: string): string {
  const lines = diff.split('\n').map(line => {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      return chalk.green(line);
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      return chalk.red(line);
    }
    if (line.startsWith('@@')) {
      return chalk.cyan(line);
    }
    return chalk.gray(line);
  });

  return boxify('DIFF', lines.join('\n'));
}
```

### Status de Ações

```typescript
const STATUS_ICONS = {
  success:  chalk.green('✓'),
  error:    chalk.red('✗'),
  warning:  chalk.yellow('⚠'),
  info:     chalk.blue('ℹ'),
  pending:  chalk.gray('○'),
  running:  chalk.yellow('⠋'),
  blocked:  chalk.red('⊘'),
};

function renderActionStatus(action: string, status: keyof typeof STATUS_ICONS): string {
  return `${STATUS_ICONS[status]} ${action}`;
}
```

## Animações

### Progress para tarefas longas

```typescript
import cliProgress from 'cli-progress';

function createTaskProgress(total: number): cliProgress.SingleBar {
  return new cliProgress.SingleBar({
    format: '{bar} │ {percentage}% │ {value}/{total} │ {task}',
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true,
  });
}

// Uso
const progress = createTaskProgress(5);
progress.start(5, 0, { task: 'Analisando arquivos...' });
progress.update(1, { task: 'Lendo package.json' });
progress.update(2, { task: 'Detectando stack' });
// ...
progress.stop();
```

### Transição de Modo

```typescript
async function animateModeSwitch(from: Mode, to: Mode): Promise<void> {
  const fromConfig = MODE_INDICATORS[from];
  const toConfig = MODE_INDICATORS[to];

  // Fade out do modo antigo
  process.stdout.write(`\r${chalk.dim(fromConfig.label)} → `);
  await sleep(150);

  // Fade in do modo novo
  process.stdout.write(chalk[toConfig.color].bold(toConfig.label));
  await sleep(150);

  // Linha completa
  console.log(` ${toConfig.icon}`);
}
```

## Implementação Real com Ink

```tsx
// Exemplo usando ink (React para terminal)
import React, { useState } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import Spinner from 'ink-spinner';

function AgentUI() {
  const [mode, setMode] = useState<Mode>('CHAT');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const { exit } = useApp();

  useInput((input, key) => {
    if (input === 'p') setMode('PLAN');
    if (input === 'a') setMode('ACT');
    if (input === 'r') setMode('RESEARCH');
    if (input === 'q') exit();
  });

  return (
    <Box flexDirection="column" borderStyle="round" padding={1}>
      {/* Status bar */}
      <Box>
        <Text color={MODE_INDICATORS[mode].color} bold>
          {MODE_INDICATORS[mode].icon} {mode}
        </Text>
        <Text dimColor> │ projeto: {projectName}</Text>
      </Box>

      {/* Messages */}
      <Box flexDirection="column" marginY={1}>
        {messages.map((msg, i) => (
          <MessageView key={i} message={msg} />
        ))}
      </Box>

      {/* Spinner */}
      {isThinking && (
        <Box>
          <Text color="cyan">
            <Spinner type="dots" /> Pensando...
          </Text>
        </Box>
      )}

      {/* Keybinds */}
      <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
        <Text dimColor>
          [P]lan  [A]ct  [R]esearch  [/]help  [q]uit
        </Text>
      </Box>
    </Box>
  );
}

render(<AgentUI />);
```

## Regras de UI

1. **Sempre mostrar o modo atual** — o usuário deve saber em qual modo está.
2. **Spinner durante processamento** — nunca deixar o terminal "congelado" sem feedback.
3. **Código sempre com highlight** — usar shiki ou cli-highlight.
4. **Diffs sempre coloridos** — verde para adições, vermelho para remoções.
5. **Erros em vermelho, sucessos em verde** — padrão universal.
6. **Ações com ícone de status** — ✓ ✗ ⚠ ℹ para cada ação executada.
7. **Barra de atalhos visível** — o usuário sabe o que pode fazer.
8. **Nunca renderizar UI falsa** — se o painel mostra "Executando...", o comando DEVE estar executando de fato.
