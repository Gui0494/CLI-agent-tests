import * as readline from "readline";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import chalk from "chalk";
import { PythonBridge } from "../bridge/python-bridge.js";
import { createExecutor } from "../executor/runner.js";
import { createVerifier } from "../verifier/test-runner.js";
import { readFile, writeFile } from "../editor/file-ops.js";
import { renderMarkdown, renderCitations } from "./renderer.js";
import { COMMANDS, getHelp } from "./commands.js";

const HISTORY_FILE = path.join(os.homedir(), ".aurex_history");

function parseCommandArgs(input: string): string[] {
  const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  const matches = [];
  let match;
  while ((match = regex.exec(input)) !== null) {
    matches.push(match[1] || match[2] || match[3]);
  }
  return matches;
}

export async function startRepl(): Promise<void> {
  const bridge = new PythonBridge();
  const executor = createExecutor({});

  console.log(chalk.bold.cyan("\n  AurexAI v0.1.0"));
  console.log(chalk.gray("  Type /help for commands, Ctrl+C to exit\n"));

  try {
    await bridge.start();
  } catch (err) {
    console.log(chalk.yellow("  Python bridge not available. LLM/search features disabled."));
    console.log(chalk.gray("  Run: cd python && pip install -e .\n"));
  }

  const completer = (line: string) => {
    const completions = ["/help", "/search", "/exec", "/edit", "/test", "/plan", "/agent", "/read", "/fetch", "/exit"];
    const hits = completions.filter((c) => c.startsWith(line));
    return [hits.length ? hits : completions, line];
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green("aurex> "),
    completer,
  });

  // Load history
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      const history = fs.readFileSync(HISTORY_FILE, "utf-8").split("\n").filter(Boolean);
      (rl as any).history = history.reverse(); // readline requires reversed array
    } catch {
      // Ignore history read errors
    }
  }

  rl.prompt();

  rl.on("line", async (line: string) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    try {
      if (input.startsWith("/")) {
        fs.appendFileSync(HISTORY_FILE, input + "\n");
        await handleCommand(input, bridge, executor);
      } else {
        fs.appendFileSync(HISTORY_FILE, input + "\n");
        await handleChat(input, bridge);
      }
    } catch (err: any) {
      console.log(chalk.red(`Error: ${err.message}`));
    }

    rl.prompt();
  });

  rl.on("close", () => {
    bridge.stop();
    console.log(chalk.gray("\nGoodbye!"));
    process.exit(0);
  });
}

async function handleCommand(
  input: string,
  bridge: PythonBridge,
  executor: ReturnType<typeof createExecutor>
): Promise<void> {
  const parts = parseCommandArgs(input.slice(1));
  const cmd = parts[0];
  const args = parts.slice(1).join(" "); // Re-join for backward compatibility with some commands, or they can use parts
  const parsedArgs = parts.slice(1);

  switch (cmd) {
    case "help":
      console.log(getHelp());
      break;

    case "search":
    case "s":
      if (!args) {
        console.log(chalk.yellow("Usage: /search <query>"));
        break;
      }
      console.log(chalk.gray("Searching..."));
      const searchResults = await bridge.call("search", { query: args });
      renderCitations(searchResults.citations || []);
      break;

    case "exec":
    case "x":
      if (!args) {
        console.log(chalk.yellow("Usage: /exec <command>"));
        break;
      }
      console.log(chalk.gray(`Running: ${args}`));
      const result = await executor.run(args);
      if (result.stdout) console.log(result.stdout);
      if (result.stderr) console.log(chalk.red(result.stderr));
      console.log(chalk.gray(`Exit code: ${result.exitCode}`));
      break;

    case "edit":
    case "e":
      if (parsedArgs.length < 2) {
        console.log(chalk.yellow("Usage: /edit <file> <instruction>"));
        break;
      }
      const file = parsedArgs[0];
      const instruction = parsedArgs.slice(1).join(" ");
      console.log(chalk.gray(`Editing ${file}...`));
      const content = await readFile(file);
      const edited = await bridge.call("llm_chat", {
        messages: [
          { role: "system", content: "You are a code editor. Return ONLY the modified file content." },
          { role: "user", content: `File: ${file}\nInstruction: ${instruction}\n\nContent:\n${content}` },
        ],
      });
      await writeFile(file, edited.content);
      console.log(chalk.green(`Updated ${file}`));
      break;

    case "test":
    case "t":
      const verifier = createVerifier({});
      const testResults = await verifier.runPipeline();
      for (const r of testResults) {
        const icon = r.passed ? chalk.green("\u2713") : chalk.red("\u2717");
        console.log(`${icon} ${r.stage}: ${r.passed ? "PASSED" : "FAILED"}`);
      }
      break;



    case "plan":
    case "p":
      if (!args) {
        console.log(chalk.yellow("Usage: /plan <task description>"));
        break;
      }
      console.log(chalk.gray("Planning..."));
      const plan = await bridge.call("llm_plan", { task: args });
      renderMarkdown(plan.plan);
      break;

    case "agent":
    case "a":
      if (!args) {
        console.log(chalk.yellow("Usage: /agent <task>"));
        break;
      }
      console.log(chalk.gray("Starting autonomous agent..."));
      const { AgentLoop } = await import("../agent/loop.js");
      const loop = new AgentLoop(bridge);
      await loop.run({ task: args, maxSteps: 15 });
      break;

    case "read":
    case "r":
      if (!args) {
        console.log(chalk.yellow("Usage: /read <file>"));
        break;
      }
      const fileContent = await readFile(args);
      console.log(fileContent);
      break;

    case "fetch":
    case "f":
      if (!args) {
        console.log(chalk.yellow("Usage: /fetch <url>"));
        break;
      }
      console.log(chalk.gray("Fetching..."));
      const fetched = await bridge.call("fetch_url", { url: args });
      console.log(fetched.content);
      break;

    case "exit":
    case "q":
      console.log(chalk.gray("\nGoodbye!"));
      process.exit(0);
      break;

    default:
      console.log(chalk.yellow(`Unknown command: /${cmd}. Type /help for available commands.`));
  }
}

async function handleChat(input: string, bridge: PythonBridge): Promise<void> {
  const response = await bridge.call("llm_chat", {
    messages: [{ role: "user", content: input }],
  });
  renderMarkdown(response.content);
}
