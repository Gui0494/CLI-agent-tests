/**
 * Slash command registry.
 *
 * Each command is a simple async function receiving the raw args string
 * and a context object containing bridge, executor, appContext, etc.
 */

import chalk from "chalk";
import { PythonBridge } from "../../bridge/python-bridge.js";
import { AppContext } from "../../context.js";
import { Mode } from "../../agent/modes.js";

export interface SlashCommandContext {
  bridge: PythonBridge;
  executor: ReturnType<typeof import("../../executor/runner.js").createExecutor>;
  appContext: AppContext;
}

export type SlashCommandHandler = (
  args: string,
  ctx: SlashCommandContext
) => Promise<void>;

export interface SlashCommandDef {
  name: string;
  aliases: string[];
  description: string;
  handler: SlashCommandHandler;
}

// ─── New Slash Commands ───────────────────────────────────

const compactCommand: SlashCommandDef = {
  name: "compact",
  aliases: [],
  description: "Compress conversation context (optional: custom focus instructions)",
  handler: async (args, ctx) => {
    const instructions = args.trim() || undefined;
    const result = ctx.appContext.session.conversation.compress(instructions);
    console.log(chalk.cyan("Compaction complete:"));
    console.log(chalk.gray(`  Pruned: ${result.pruned} tool results`));
    console.log(chalk.gray(`  Summarized: ${result.summarized} messages`));
    console.log(chalk.gray(`  Truncated: ${result.truncated} messages`));
    if (result.checklist) {
      console.log(chalk.gray("\n" + result.checklist));
    }
    // Reload AGENT.md files (survive compaction)
    ctx.appContext.session.reloadAgentFiles();
  },
};

const modelCommand: SlashCommandDef = {
  name: "model",
  aliases: [],
  description: "Show or change the current LLM model",
  handler: async (args, ctx) => {
    if (!args.trim()) {
      console.log(chalk.cyan("Current model: (configured in config.yaml llm.model)"));
      return;
    }
    // Model switching would require bridge support; for now just acknowledge
    console.log(chalk.yellow(`Model switching to '${args.trim()}' — requires bridge restart.`));
  },
};

const addCommand: SlashCommandDef = {
  name: "add",
  aliases: [],
  description: "Add a file to the conversation context",
  handler: async (args, ctx) => {
    const filePath = args.trim();
    if (!filePath) {
      console.log(chalk.yellow("Usage: /add <file>"));
      return;
    }
    try {
      const { readFile } = await import("../../editor/file-ops.js");
      const content = await readFile(filePath);
      ctx.appContext.session.conversation.addMessage(
        "user",
        `[Context file: ${filePath}]\n${content}`,
        ctx.appContext.modeManager.getMode()
      );
      ctx.appContext.session.fileCache.get(filePath); // warm the cache
      console.log(chalk.green(`Added ${filePath} to context`));
    } catch (err: any) {
      console.log(chalk.red(`Cannot read file: ${err.message}`));
    }
  },
};

const dropCommand: SlashCommandDef = {
  name: "drop",
  aliases: [],
  description: "Remove a file from the conversation context",
  handler: async (args, ctx) => {
    const filePath = args.trim();
    if (!filePath) {
      console.log(chalk.yellow("Usage: /drop <file>"));
      return;
    }
    ctx.appContext.session.fileCache.invalidate(filePath);
    console.log(chalk.green(`Dropped ${filePath} from context`));
  },
};

const undoCommand: SlashCommandDef = {
  name: "undo",
  aliases: [],
  description: "Revert the last file edit (uses git checkout)",
  handler: async (args, ctx) => {
    try {
      const { execSync } = await import("child_process");
      const output = execSync("git diff --name-only HEAD", { encoding: "utf-8" }).trim();
      if (!output) {
        console.log(chalk.yellow("No uncommitted changes to undo."));
        return;
      }
      const files = output.split("\n");
      const target = args.trim() || files[files.length - 1];
      execSync(`git checkout -- "${target}"`);
      console.log(chalk.green(`Reverted: ${target}`));
    } catch (err: any) {
      console.log(chalk.red(`Undo failed: ${err.message}`));
    }
  },
};

const diffCommand: SlashCommandDef = {
  name: "diff",
  aliases: [],
  description: "Show uncommitted changes in the session",
  handler: async (_args, _ctx) => {
    try {
      const { execSync } = await import("child_process");
      const output = execSync("git diff --stat", { encoding: "utf-8" }).trim();
      if (!output) {
        console.log(chalk.gray("No changes."));
      } else {
        console.log(output);
      }
    } catch (err: any) {
      console.log(chalk.red(`Diff failed: ${err.message}`));
    }
  },
};

const tokensCommand: SlashCommandDef = {
  name: "tokens",
  aliases: [],
  description: "Show token usage and context utilization",
  handler: async (_args, ctx) => {
    const conv = ctx.appContext.session.conversation;
    const utilization = (conv.getUtilization() * 100).toFixed(1);
    console.log(chalk.cyan("Token usage:"));
    console.log(chalk.gray(`  Messages:    ${conv.getMessageCount()}`));
    console.log(chalk.gray(`  Total tokens: ${conv.getTotalTokens()}`));
    console.log(chalk.gray(`  Utilization:  ${utilization}%`));
    console.log(chalk.gray(`  Files cached: ${ctx.appContext.session.fileCache.size()}`));
    console.log(chalk.gray(`  Tool calls:   ${ctx.appContext.session.toolCallCount}`));
  },
};

const modeCommand: SlashCommandDef = {
  name: "mode",
  aliases: [],
  description: "Show or change the current mode (chat/plan/act/auto/research)",
  handler: async (args, ctx) => {
    if (!args.trim()) {
      console.log(chalk.cyan(`Current mode: ${ctx.appContext.modeManager.getMode()}`));
      return;
    }
    const target = args.trim().toUpperCase() as Mode;
    const validModes: Mode[] = [Mode.CHAT, Mode.PLAN, Mode.ACT, Mode.AUTO, Mode.RESEARCH];
    if (!validModes.includes(target)) {
      console.log(chalk.yellow(`Invalid mode. Valid: ${validModes.join(", ").toLowerCase()}`));
      return;
    }
    try {
      await ctx.appContext.modeManager.switch(target);
      console.log(chalk.green(`Mode changed to: ${target}`));
    } catch (err: any) {
      console.log(chalk.red(err.message));
    }
  },
};

const clearCommand: SlashCommandDef = {
  name: "clear",
  aliases: [],
  description: "Clear conversation history (keeps session memory)",
  handler: async (_args, ctx) => {
    ctx.appContext.session.conversation.clear();
    console.log(chalk.green("Conversation cleared."));
  },
};

const statusCommand: SlashCommandDef = {
  name: "status",
  aliases: [],
  description: "Show current session status",
  handler: async (_args, ctx) => {
    const stats = ctx.appContext.session.getStats();
    const mode = ctx.appContext.modeManager.getMode();
    const elapsed = Math.round((Date.now() - stats.startedAt) / 1000 / 60);
    console.log(chalk.cyan("Session status:"));
    console.log(chalk.gray(`  Mode:         ${mode}`));
    console.log(chalk.gray(`  Duration:     ${elapsed}min`));
    console.log(chalk.gray(`  Messages:     ${stats.messageCount}`));
    console.log(chalk.gray(`  Tool calls:   ${stats.toolCallCount}`));
    console.log(chalk.gray(`  Tokens:       ${stats.totalTokens}`));
    console.log(chalk.gray(`  Files cached: ${stats.fileCacheSize}`));
    console.log(chalk.gray(`  Approvals:    ${stats.approvalCount}`));
    if (stats.activePlan) {
      console.log(chalk.gray(`  Active plan:  ${stats.activePlan}`));
    }
    // Show AGENT.md files loaded
    const agentFiles = ctx.appContext.session.agentFiles;
    if (agentFiles.length > 0) {
      console.log(chalk.gray(`  AGENT.md:     ${agentFiles.map(f => f.source).join(", ")}`));
    }
  },
};

// ─── Registry ─────────────────────────────────────────────

export const NEW_SLASH_COMMANDS: SlashCommandDef[] = [
  compactCommand,
  modelCommand,
  addCommand,
  dropCommand,
  undoCommand,
  diffCommand,
  tokensCommand,
  modeCommand,
  clearCommand,
  statusCommand,
];

/** Build a name→handler map for quick lookup. */
export function buildCommandMap(
  commands: SlashCommandDef[]
): Map<string, SlashCommandDef> {
  const map = new Map<string, SlashCommandDef>();
  for (const cmd of commands) {
    map.set(cmd.name, cmd);
    for (const alias of cmd.aliases) {
      map.set(alias, cmd);
    }
  }
  return map;
}
