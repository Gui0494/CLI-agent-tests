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
  // Try local search first (faster, no API cost)
  const localResults = await localSearch(query);
  if (localResults.length > 0) {
    return localResults.map((r) => ({
      file: r.file,
      line: r.line,
      content: r.content,
      source: "local" as const,
    }));
  }

  // Fallback to GitHub search API
  try {
    const { data } = await octokit.search.code({
      q: `${query} repo:${owner}/${repo}`,
      per_page: 10,
    });

    return data.items.map((item) => ({
      file: item.path,
      content: item.name,
      source: "github" as const,
      url: item.html_url,
    }));
  } catch {
    return [];
  }
}
