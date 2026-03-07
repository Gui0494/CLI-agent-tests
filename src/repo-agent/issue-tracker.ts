import { Octokit } from "@octokit/rest";

export interface IssueAction {
  action: "label" | "assign" | "close" | "comment";
  issueNumber: number;
  value: string;
}

export async function processIssueActions(
  octokit: Octokit,
  owner: string,
  repo: string,
  actions: IssueAction[]
): Promise<void> {
  for (const action of actions) {
    switch (action.action) {
      case "label":
        await octokit.issues.addLabels({
          owner,
          repo,
          issue_number: action.issueNumber,
          labels: [action.value],
        });
        break;
      case "assign":
        await octokit.issues.addAssignees({
          owner,
          repo,
          issue_number: action.issueNumber,
          assignees: [action.value],
        });
        break;
      case "comment":
        await octokit.issues.createComment({
          owner,
          repo,
          issue_number: action.issueNumber,
          body: action.value,
        });
        break;
      case "close":
        await octokit.issues.update({
          owner,
          repo,
          issue_number: action.issueNumber,
          state: "closed",
        });
        break;
    }
  }
}
