import chalk from "chalk";

export interface CommandDef {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
}

export const COMMANDS: CommandDef[] = [
  { name: "help", aliases: ["h"], description: "Show this help message", usage: "/help" },
  { name: "search", aliases: ["s"], description: "Search the web", usage: "/search <query>" },
  { name: "exec", aliases: ["x"], description: "Execute command in sandbox", usage: "/exec <command>" },
  { name: "edit", aliases: ["e"], description: "Edit file with AI", usage: "/edit <file> <instruction>" },
  { name: "test", aliases: ["t"], description: "Run verifier pipeline", usage: "/test" },
  { name: "plan", aliases: ["p"], description: "Generate execution plan", usage: "/plan <task>" },
  { name: "agent", aliases: ["a"], description: "Run autonomous agent loop", usage: "/agent <task> [-s max_steps]" },
  { name: "read", aliases: ["r"], description: "Read a file", usage: "/read <file>" },
  { name: "fetch", aliases: ["f"], description: "Fetch and extract URL content", usage: "/fetch <url>" },
  { name: "init", aliases: [], description: "Detect project and generate .aurex/project.yaml", usage: "/init" },
  { name: "compact", aliases: [], description: "Compact conversation context", usage: "/compact" },
  { name: "cost", aliases: [], description: "Show token usage and cost estimate", usage: "/cost" },
  { name: "diff", aliases: [], description: "Show git diff", usage: "/diff" },
  { name: "undo", aliases: [], description: "Undo last conversation turn", usage: "/undo" },
  { name: "commit", aliases: [], description: "Smart commit with AI message", usage: "/commit" },
];

export function getHelp(): string {
  const lines = [
    chalk.bold.cyan("\nAurexAI Commands\n"),
    ...COMMANDS.map(
      (c) =>
        `  ${chalk.green(c.usage.padEnd(35))} ${c.description}` +
        (c.aliases.length ? chalk.gray(` (/${c.aliases.join(", /")})`) : "")
    ),
    "",
    chalk.gray("  Or just type naturally to chat with the AI.\n"),
  ];
  return lines.join("\n");
}
