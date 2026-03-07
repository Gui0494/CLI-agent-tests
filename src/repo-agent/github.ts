import { Octokit } from "@octokit/rest";
import { exec } from "child_process";
import { promisify } from "util";
import type { PythonBridge } from "../bridge/python-bridge.js";

const execAsync = promisify(exec);

export interface RepoAgentConfig {
  token?: string;
  bridge?: PythonBridge;
}

export function createRepoAgent(config: RepoAgentConfig = {}) {
  const token = config.token || process.env.GITHUB_TOKEN;
  const octokit = new Octokit({ auth: token });

  return {
    async getRepoInfo(): Promise<{ owner: string; repo: string }> {
      const { stdout } = await execAsync("git remote get-url origin");
      const match = stdout.trim().match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
      if (!match) throw new Error("Could not parse GitHub remote URL");
      return { owner: match[1], repo: match[2] };
    },

    async createPR(opts: { base?: string; title?: string; body?: string } = {}): Promise<void> {
      const { owner, repo } = await this.getRepoInfo();
      const { stdout: branch } = await execAsync("git branch --show-current");
      const head = branch.trim();

      console.log(`Pushing branch ${head} to origin...`);
      await execAsync(`git push -u origin ${head}`);

      const { data: pr } = await octokit.pulls.create({
        owner,
        repo,
        title: opts.title || `[AurexAI] Changes from ${head}`,
        body: opts.body || "Auto-generated PR by AurexAI",
        head,
        base: opts.base || "main",
      });

      console.log(`PR #${pr.number} created: ${pr.html_url}`);
    },

    async reviewPR(prNumber: number): Promise<void> {
      const { owner, repo } = await this.getRepoInfo();

      const { data: files } = await octokit.pulls.listFiles({ owner, repo, pull_number: prNumber });

      console.log(`\nPR #${prNumber} - ${files.length} files changed. Analyzing...`);

      let reviewBody = "## AurexAI Automated Code Review\n\n";
      let hasFeedback = false;

      for (const file of files) {
        if (!file.patch || !config.bridge) continue;

        console.log(`Reviewing ${file.filename}...`);
        const res = await config.bridge.call("llm_chat", {
          messages: [
            { role: "system", content: "You are a strict but helpful code reviewer. Return ONLY concise, actionable feedback for the provided git diff. If the code looks good, return exactly 'LGTM'." },
            { role: "user", content: `File: ${file.filename}\nDiff:\n${file.patch}` }
          ]
        });

        if (res.content.trim() !== "LGTM") {
          reviewBody += `### \`${file.filename}\`\n${res.content}\n\n`;
          hasFeedback = true;
        }
      }

      const finalBody = hasFeedback ? reviewBody : "## AurexAI Automated Code Review\n\nLGTM! No significant issues found.";

      await octokit.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        event: "COMMENT",
        body: finalBody,
      });

      console.log(`Review posted to PR #${prNumber}`);
    },

    async listPRs(): Promise<void> {
      const { owner, repo } = await this.getRepoInfo();

      const { data: prs } = await octokit.pulls.list({ owner, repo, state: "open", per_page: 20 });

      if (prs.length === 0) {
        console.log("No open PRs.");
        return;
      }

      for (const pr of prs) {
        console.log(`  #${pr.number} ${pr.title} (${pr.user?.login}) [${pr.head.ref}]`);
      }
    },

    async createIssue(title: string, body: string, labels: string[] = []): Promise<void> {
      const { owner, repo } = await this.getRepoInfo();

      const { data: issue } = await octokit.issues.create({
        owner,
        repo,
        title,
        body,
        labels,
      });

      console.log(`Issue #${issue.number} created: ${issue.html_url}`);
    },

    async searchCode(query: string): Promise<void> {
      const { owner, repo } = await this.getRepoInfo();

      const { data } = await octokit.search.code({
        q: `${query} repo:${owner}/${repo}`,
        per_page: 10,
      });

      for (const item of data.items) {
        console.log(`  ${item.path}:${item.name}`);
      }
    },
  };
}
