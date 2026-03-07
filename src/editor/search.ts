import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface SearchResult {
  file: string;
  line: number;
  content: string;
}

/**
 * Search for a pattern in files using ripgrep (falls back to grep).
 */
export async function searchCode(
  pattern: string,
  dir: string = ".",
  options: { glob?: string; maxResults?: number } = {}
): Promise<SearchResult[]> {
  const maxResults = options.maxResults || 50;

  try {
    // Try ripgrep first
    const args = ["--line-number", "--no-heading", "-m", String(maxResults)];
    if (options.glob) args.push("--glob", options.glob);
    args.push(pattern, dir);

    const { stdout } = await execFileAsync("rg", args, { maxBuffer: 1024 * 1024 });
    return parseGrepOutput(stdout);
  } catch {
    // Fallback to grep
    try {
      const args = ["-rn", "--max-count", String(maxResults)];
      if (options.glob) args.push("--include", options.glob);
      args.push(pattern, dir);

      const { stdout } = await execFileAsync("grep", args, { maxBuffer: 1024 * 1024 });
      return parseGrepOutput(stdout);
    } catch {
      return [];
    }
  }
}

function parseGrepOutput(output: string): SearchResult[] {
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.+?):(\d+):(.*)$/);
      if (!match) return null;
      return { file: match[1], line: parseInt(match[2]), content: match[3].trim() };
    })
    .filter((r): r is SearchResult => r !== null);
}
