import * as readline from "readline";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import chalk from "chalk";
import { PythonBridge } from "../bridge/python-bridge.js";
import { createExecutor } from "../executor/runner.js";
import { createVerifier } from "../verifier/test-runner.js";
import { readFile, writeFile } from "../editor/file-ops.js";
import { renderMarkdown, renderCitations, Citation } from "./renderer.js";
import { COMMANDS, getHelp } from "./commands.js";
import { createAppContext } from "../context.js";
import { detectProject } from "../init/project-detector.js";
import { generateProjectYaml } from "../init/project-yaml.js";
import { setupBridgeHandlers } from "./setup-bridge.js";
import { getHookEngine, HookEvent } from "../hooks/engine.js";
import { preShellHook } from "../hooks/rules/pre-shell.js";
import { postEditHook } from "../hooks/rules/post-edit.js";
import { workspaceSandboxHook } from "../hooks/rules/workspace-sandbox.js";
import { runDoctor, printDoctorResult } from "../hooks/rules/on-session-start.js";

const CONFIG_DIR = path.join(os.homedir(), ".config", "aurex");
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}
const HISTORY_FILE = path.join(CONFIG_DIR, "history");

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
    const completions = ["/help", "/search", "/exec", "/edit", "/test", "/plan", "/agent", "/read", "/fetch", "/init", "/compact", "/cost", "/diff", "/undo", "/commit", "/exit"];
    const hits = completions.filter((c) => c.startsWith(line));
    return [hits.length ? hits : completions, line];
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green("aurex> "),
    completer,
  });

  const appContext = createAppContext();

  // Register hook rules
  const hookEngine = getHookEngine();
  hookEngine.register("pre-shell-blocklist", HookEvent.PRE_SHELL, preShellHook, 10);
  hookEngine.register("workspace-sandbox", HookEvent.PRE_WRITE, workspaceSandboxHook, 10);
  hookEngine.register("post-edit-formatter", HookEvent.POST_EDIT, postEditHook, 50);

  // Run doctor checks and populate session memory
  const doctorResult = await runDoctor();
  appContext.session.doctorResult = doctorResult;
  printDoctorResult(doctorResult);
  await appContext.session.loadProjectContext();

  appContext.modeManager.setConfirmFunction(async (msg) => {
    return new Promise<boolean>((resolve) => {
        rl.question(chalk.yellow(msg + " "), (ans: string) => {
            resolve(["y", "yes", "s", "sim"].includes(ans.trim().toLowerCase()));
        });
    });
  });

  setupBridgeHandlers(bridge, appContext, rl, {});

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
        await handleCommand(input, bridge, executor, appContext);
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
  executor: ReturnType<typeof createExecutor>,
  appContext: any
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
    case "s": {
      if (!bridge.isStarted()) {
        console.log(chalk.yellow("  Search requires the Python bridge (LLM)."));
        break;
      }
      if (!args) {
        console.log(chalk.yellow("Usage: /search <query>"));
        break;
      }
      console.log(chalk.gray("Searching..."));
      const searchResults = await bridge.call<{ citations?: Citation[] }>("search", { query: args });
      renderCitations(searchResults.citations || []);
      break;
    }

    case "exec":
    case "x": {
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
    }

    case "edit":
    case "e": {
      if (!bridge.isStarted()) {
        console.log(chalk.yellow("  Edit requires the Python bridge (LLM)."));
        break;
      }
      if (parsedArgs.length < 2) {
        console.log(chalk.yellow("Usage: /edit <file> <instruction>"));
        break;
      }
      const file = parsedArgs[0];
      const instruction = parsedArgs.slice(1).join(" ");
      console.log(chalk.gray(`Editing ${file}...`));
      const content = await readFile(file);
      const edited = await bridge.call<{ content: string }>("llm_chat", {
        messages: [
          { role: "system", content: "You are a code editor. Return ONLY the modified file content." },
          { role: "user", content: `File: ${file}\nInstruction: ${instruction}\n\nContent:\n${content}` },
        ],
      });
      await writeFile(file, edited.content);
      console.log(chalk.green(`Updated ${file}`));
      break;
    }

    case "test":
    case "t": {
      const verifier = createVerifier({});
      const testResults = await verifier.runPipeline();
      for (const r of testResults) {
        const icon = r.passed ? chalk.green("\u2713") : chalk.red("\u2717");
        console.log(`${icon} ${r.stage}: ${r.passed ? "PASSED" : "FAILED"}`);
      }
      break;
    }



    case "agent":
    case "a": {
      if (!bridge.isStarted()) {
        console.log(chalk.yellow("  Agent commands require the Python bridge (LLM)."));
        break;
      }
      if (!args) {
        console.log(chalk.yellow("Usage: /agent <task>"));
        break;
      }
      console.log(chalk.gray("Starting autonomous agent..."));
      const { AgentLoop } = await import("../agent/loop.js");
      const loop = new AgentLoop(bridge, appContext);
      await loop.run({ task: args, maxSteps: 15 });
      break;
    }

    case "plan":
    case "p": {
      if (!bridge.isStarted()) {
        console.log(chalk.yellow("  Plan requires the Python bridge (LLM)."));
        break;
      }
      if (!args) {
        console.log(chalk.yellow("Usage: /plan <goal>"));
        break;
      }
      console.log(chalk.gray(`Drafting plan for: ${args}`));
      await bridge.call<{ plan?: string }>("agent_plan", { task: args }, 300000);
      break;
    }

    case "read":
    case "r": {
      if (!args) {
        console.log(chalk.yellow("Usage: /read <file>"));
        break;
      }
      const fileContent = await readFile(args);
      console.log(fileContent);
      break;
    }

    case "fetch":
    case "f": {
      if (!bridge.isStarted()) {
        console.log(chalk.yellow("  Fetch requires the Python bridge."));
        break;
      }
      if (!args) {
        console.log(chalk.yellow("Usage: /fetch <url>"));
        break;
      }
      console.log(chalk.gray("Fetching..."));
      const fetched = await bridge.call<{ content: string }>("fetch_url", { url: args });
      console.log(fetched.content);
      break;
    }

    case "init": {
      console.log(chalk.gray("Detecting project..."));
      const project = await detectProject();
      const yamlPath = await generateProjectYaml(project);
      console.log(chalk.green(`Project detected: ${project.name}`));
      console.log(chalk.gray(`  Stack: ${project.stack.join(", ") || "none detected"}`));
      console.log(chalk.gray(`  Package manager: ${project.packageManager}`));
      console.log(chalk.gray(`  Test: ${project.testCommand}`));
      console.log(chalk.gray(`  Build: ${project.buildCommand || "none"}`));
      console.log(chalk.green(`Saved to ${yamlPath}`));
      break;
    }

    case "compact": {
      if (!bridge.isStarted()) {
        console.log(chalk.yellow("  Compact requires the Python bridge."));
        break;
      }
      console.log(chalk.gray("Compacting context..."));
      const compactResult = await bridge.call<{ removed?: number }>("manage_history", { action: "compact" });
      console.log(chalk.green(`Context compacted. ${compactResult.removed ?? 0} messages summarized.`));
      break;
    }

    case "cost": {
      const summary = appContext.session.tokenTracker.getSummary();
      console.log(chalk.bold.cyan("\nToken Usage"));
      console.log(`  Prompt:     ${summary.consumed.prompt.toLocaleString()}`);
      console.log(`  Completion: ${summary.consumed.completion.toLocaleString()}`);
      console.log(`  Total:      ${summary.consumed.total.toLocaleString()} / ${summary.budget.toLocaleString()}`);
      console.log(`  Remaining:  ${summary.remaining.toLocaleString()}`);
      console.log(`  Est. cost:  $${summary.costEstimateUsd.toFixed(4)}`);
      if (summary.overBudget) console.log(chalk.red("  WARNING: Over budget!"));
      console.log();
      break;
    }

    case "diff": {
      console.log(chalk.gray("Getting git diff..."));
      const diffResult = await executor.run("git diff");
      const stagedResult = await executor.run("git diff --staged");
      if (stagedResult.stdout) {
        console.log(chalk.bold.cyan("Staged changes:"));
        console.log(stagedResult.stdout);
      }
      if (diffResult.stdout) {
        console.log(chalk.bold.cyan("Unstaged changes:"));
        console.log(diffResult.stdout);
      }
      if (!diffResult.stdout && !stagedResult.stdout) {
        console.log(chalk.gray("No changes."));
      }
      break;
    }

    case "undo": {
      if (!bridge.isStarted()) {
        console.log(chalk.yellow("  Undo requires the Python bridge."));
        break;
      }
      const undoResult = await bridge.call<{ removed?: number }>("manage_history", { action: "undo" });
      console.log(chalk.green(`Undone. ${undoResult.removed ?? 0} messages removed.`));
      break;
    }

    case "commit": {
      if (!bridge.isStarted()) {
        console.log(chalk.yellow("  Smart commit requires the Python bridge (LLM)."));
        break;
      }
      const commitDiff = await executor.run("git diff --staged");
      if (!commitDiff.stdout) {
        console.log(chalk.yellow("No staged changes. Use 'git add' first."));
        break;
      }
      console.log(chalk.gray("Generating commit message..."));
      const msgResult = await bridge.call<{ content: string }>("llm_chat", {
        messages: [
          { role: "system", content: "Generate a concise conventional commit message for this diff. Return ONLY the commit message, no explanation." },
          { role: "user", content: commitDiff.stdout.slice(0, 10000) },
        ],
      });
      const commitMsg = msgResult.content.trim().replace(/^["']|["']$/g, "");
      console.log(chalk.cyan(`Commit message: ${commitMsg}`));
      const commitResult = await executor.run(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`);
      if (commitResult.exitCode === 0) {
        console.log(chalk.green("Committed successfully."));
      } else {
        console.log(chalk.red(`Commit failed: ${commitResult.stderr}`));
      }
      break;
    }

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
  if (!bridge.isStarted()) {
    console.log(chalk.yellow("  Python bridge is not running. LLM features are disabled."));
    console.log(chalk.gray("  You can still use local tools like /exec, /read, etc."));
    return;
  }

  // Try streaming first, fall back to non-streaming
  try {
    const controller = new AbortController();
    const onSigint = () => controller.abort();
    process.once("SIGINT", onSigint);
    let hasOutput = false;

    try {
      await bridge.callStream("llm_stream", {
        messages: [{ role: "user", content: input }],
      }, {
        onChunk: (token: string) => {
          process.stdout.write(token);
          hasOutput = true;
        },
        signal: controller.signal,
      });
      if (hasOutput) console.log(); // newline after stream
    } finally {
      process.off("SIGINT", onSigint);
    }
  } catch {
    // Fallback to non-streaming
    const response = await bridge.call<{ content: string }>("llm_chat", {
      messages: [{ role: "user", content: input }],
    });
    renderMarkdown(response.content);
  }
}
