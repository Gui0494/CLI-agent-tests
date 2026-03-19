#!/usr/bin/env node

import { config } from "dotenv";
import { Command } from "commander";
import { startRepl } from "./cli/repl.js";
import { createExecutor } from "./executor/runner.js";
import { createVerifier } from "./verifier/test-runner.js";
import { createRepoAgent } from "./repo-agent/github.js";
import { PythonBridge } from "./bridge/python-bridge.js";

config();

const program = new Command();

program
  .name("aurex")
  .description("AurexAI - Local CLI Agent for code editing, web search, planning, and execution")
  .version("0.1.0");

program
  .command("interactive")
  .alias("i")
  .description("Start interactive REPL mode")
  .action(async () => {
    await startRepl();
  });

program
  .command("exec <command...>")
  .description("Run a command in Docker sandbox")
  .option("-t, --timeout <ms>", "Timeout in milliseconds", "60000")
  .option("--no-sandbox", "Run without Docker (use with caution)")
  .action(async (commandParts: string[], opts) => {
    const executor = createExecutor({
      timeoutMs: parseInt(opts.timeout),
      useSandbox: opts.sandbox,
    });
    const result = await executor.run(commandParts.join(" "));
    console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
    process.exit(result.exitCode);
  });

program
  .command("search <query...>")
  .description("Search the web using AI-powered search")
  .option("-n, --max-results <n>", "Maximum results", "5")
  .action(async (queryParts: string[], opts) => {
    const bridge = new PythonBridge();
    try {
      await bridge.start();
      const results = await bridge.call<{ citations?: unknown[]; [key: string]: unknown }>("search", {
        query: queryParts.join(" "),
        max_results: parseInt(opts.maxResults),
      });
      console.log(JSON.stringify(results, null, 2));
    } finally {
      bridge.stop();
    }
  });

program
  .command("edit <file>")
  .description("Edit a file with AI assistance")
  .option("-i, --instruction <text>", "Edit instruction")
  .action(async (file: string, opts) => {
    const bridge = new PythonBridge();
    try {
      await bridge.start();
      const { readFile, writeFile } = await import("./editor/file-ops.js");
      const content = await readFile(file);

      if (!opts.instruction) {
        console.error("Please provide an instruction with -i flag");
        process.exit(1);
      }

      const result = await bridge.call<{ content: string }>("llm_chat", {
        messages: [
          {
            role: "system",
            content: "You are a code editor. Return ONLY the modified file content, no explanations.",
          },
          {
            role: "user",
            content: `File: ${file}\nInstruction: ${opts.instruction}\n\nCurrent content:\n${content}`,
          },
        ],
      });

      await writeFile(file, result.content);
      console.log(`Updated ${file}`);
    } finally {
      bridge.stop();
    }
  });

program
  .command("test")
  .description("Run verifier pipeline (tests, lint, typecheck)")
  .option("--skip-e2e", "Skip end-to-end tests")
  .action(async (opts) => {
    const verifier = createVerifier({ skipE2e: opts.skipE2e });
    const results = await verifier.runPipeline();
    for (const r of results) {
      const icon = r.passed ? "\u2713" : "\u2717";
      console.log(`${icon} ${r.stage}: ${r.passed ? "PASSED" : "FAILED"}`);
      if (!r.passed && r.errors.length > 0) {
        r.errors.forEach((e: string) => console.log(`  - ${e}`));
      }
    }
    const allPassed = results.every((r: { passed: boolean }) => r.passed);
    process.exit(allPassed ? 0 : 1);
  });

program
  .command("pr <action>")
  .description("PR management (create, review, list)")
  .option("-n, --number <n>", "PR number for review")
  .option("-b, --base <branch>", "Base branch", "main")
  .action(async (action: string, opts) => {
    const bridge = new PythonBridge();
    try {
      await bridge.start();
      const agent = createRepoAgent({ bridge });
      switch (action) {
        case "create":
          await agent.createPR({ base: opts.base });
          break;
        case "review":
          if (!opts.number) {
            console.error("PR number required: aurex pr review -n 42");
            process.exit(1);
          }
          await agent.reviewPR(parseInt(opts.number));
          break;
        case "list":
          await agent.listPRs();
          break;
        default:
          console.error(`Unknown action: ${action}`);
      }
    } finally {
      bridge.stop();
    }
  });

program
  .command("plan <task...>")
  .description("Generate an execution plan for a task")
  .action(async (taskParts: string[]) => {
    const bridge = new PythonBridge();
    try {
      await bridge.start();
      const plan = await bridge.call<{ plan: string }>("llm_plan", {
        task: taskParts.join(" "),
      });
      console.log(plan.plan);
    } finally {
      bridge.stop();
    }
  });

// Default: interactive mode
program.action(async () => {
  await startRepl();
});

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
