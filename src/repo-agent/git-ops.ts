/**
 * git-ops.ts — Git operations for AurexAI CLI Agent.
 *
 * Provides smart commit message generation and PR creation
 * using LLM to analyze diffs.
 *
 * Reference: Phase 4.3 — Git Integration
 */

import { exec } from "child_process";
import { promisify } from "util";
import type { PythonBridge } from "../bridge/python-bridge.js";

const execAsync = promisify(exec);

export async function getGitDiff(staged = false): Promise<string> {
  try {
    const { stdout } = await execAsync(staged ? "git diff --staged" : "git diff");
    return stdout;
  } catch {
    return "";
  }
}

export async function getGitStatus(): Promise<string> {
  try {
    const { stdout } = await execAsync("git status --short");
    return stdout;
  } catch {
    return "";
  }
}

export async function getGitBranch(): Promise<string> {
  try {
    const { stdout } = await execAsync("git branch --show-current");
    return stdout.trim();
  } catch {
    return "unknown";
  }
}

export async function getGitLog(count = 5): Promise<string> {
  try {
    const { stdout } = await execAsync(`git log --oneline -${count}`);
    return stdout;
  } catch {
    return "";
  }
}

export async function smartCommit(
  bridge: PythonBridge,
  ask: (q: string) => Promise<string>,
): Promise<{ ok: boolean; message: string }> {
  const diff = await getGitDiff(true);
  if (!diff) {
    return { ok: false, message: "No staged changes" };
  }

  // Generate commit message via LLM
  const result = await bridge.call<{ content: string }>("llm_chat", {
    messages: [
      {
        role: "system",
        content:
          "Generate a concise conventional commit message for this diff. " +
          "Use format: type(scope): description. " +
          "Return ONLY the commit message, nothing else.",
      },
      { role: "user", content: diff.slice(0, 10000) },
    ],
  });

  const commitMsg = result.content.trim().replace(/^["']|["']$/g, "");

  // Confirm with user
  const answer = await ask(`Commit message: "${commitMsg}"\n  [y] commit  [e] edit  [n] cancel: `);
  const cmd = answer.trim().toLowerCase();

  if (cmd === "n" || cmd === "no") {
    return { ok: false, message: "Cancelled" };
  }

  let finalMsg = commitMsg;
  if (cmd === "e" || cmd === "edit") {
    const edited = await ask("Enter commit message: ");
    finalMsg = edited.trim();
  }

  try {
    await execAsync(`git commit -m "${finalMsg.replace(/"/g, '\\"')}"`);
    return { ok: true, message: `Committed: ${finalMsg}` };
  } catch (err: any) {
    return { ok: false, message: `Commit failed: ${err.message}` };
  }
}

export async function smartPR(
  bridge: PythonBridge,
): Promise<{ title: string; body: string }> {
  const branch = await getGitBranch();
  const diff = await getGitDiff();
  const log = await getGitLog(20);

  const result = await bridge.call<{ content: string }>("llm_chat", {
    messages: [
      {
        role: "system",
        content:
          "Generate a PR title and description for these changes. " +
          "Format:\nTITLE: <title>\nBODY:\n<markdown body>\n" +
          "Keep title under 70 chars. Body should have ## Summary and ## Changes sections.",
      },
      {
        role: "user",
        content: `Branch: ${branch}\n\nRecent commits:\n${log}\n\nDiff:\n${diff.slice(0, 15000)}`,
      },
    ],
  });

  const content = result.content;
  const titleMatch = content.match(/TITLE:\s*(.+)/);
  const bodyMatch = content.match(/BODY:\s*([\s\S]+)/);

  return {
    title: titleMatch?.[1]?.trim() || `Changes from ${branch}`,
    body: bodyMatch?.[1]?.trim() || content,
  };
}
