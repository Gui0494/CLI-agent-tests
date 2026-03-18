import { Octokit } from "@octokit/rest";
import { searchCode as localSearch } from "../editor/search.js";

export interface CodeSearchResult {
  file: string;
  line?: number;
  content: string;
  source: "local" | "github";
  url?: string;
}

/**
 * Search code locally first, then fallback to GitHub API.
 */
export async function searchCodeHybrid(
  query: string,
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<CodeSearchResult[]> {
  // Run local and GitHub searches in parallel
  const [localSettled, githubSettled] = await Promise.allSettled([
    localSearch(query),
    octokit.search.code({ q: `${query} repo:${owner}/${repo}`, per_page: 10 }),
  ]);

  // Prefer local results
  const localResults = localSettled.status === "fulfilled" ? localSettled.value : [];
  if (localResults.length > 0) {
    return localResults.map((r) => ({
      file: r.file,
      line: r.line,
      content: r.content,
      source: "local" as const,
    }));
  }

  // Fall back to GitHub results
  if (githubSettled.status === "fulfilled") {
    return githubSettled.value.data.items.map((item) => ({
      file: item.path,
      content: item.name,
      source: "github" as const,
      url: item.html_url,
    }));
  }

  return [];
}
