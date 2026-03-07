import { Octokit } from "@octokit/rest";
import { PythonBridge } from "../bridge/python-bridge.js";

export interface PRReviewComment {
  path: string;
  line: number;
  body: string;
  side: "RIGHT";
}

/**
 * AI-powered PR review: analyzes diff and generates inline comments.
 */
export async function aiReviewPR(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  bridge: PythonBridge
): Promise<PRReviewComment[]> {
  // Get PR diff
  const { data: files } = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
  });

  const diffSummary = files.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch?.slice(0, 2000) || "", // limit patch size
  }));

  // Ask LLM to review
  const response = await bridge.call("llm_chat", {
    messages: [
      {
        role: "system",
        content: `You are a code reviewer. Analyze the PR diff and return a JSON array of review comments.
Each comment: {"path": "file.ts", "line": 10, "body": "suggestion", "side": "RIGHT"}
Only comment on actual issues (bugs, security, performance). Be concise.`,
      },
      {
        role: "user",
        content: JSON.stringify(diffSummary),
      },
    ],
  });

  try {
    return JSON.parse(response.content);
  } catch {
    return [];
  }
}
