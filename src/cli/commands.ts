import chalk from "chalk";
import { NEW_SLASH_COMMANDS } from "./slash-commands/index.js";

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
    chalk.bold.cyan("  Session Commands\n"),
    ...NEW_SLASH_COMMANDS.map(
      (c) =>
        `  ${chalk.green((`/${c.name}`).padEnd(35))} ${c.description}`
    ),
    "",
    chalk.gray("  Or just type naturally to chat with the AI.\n"),
  ];
  return lines.join("\n");
}
