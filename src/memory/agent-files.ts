/**
 * agent-files.ts — Hierarchical memory file loader (AGENT.md)
 *
 * Loads and concatenates memory files in precedence order:
 *  1. ~/.config/aurex/AGENT.md          (global preferences)
 *  2. <project-root>/AGENT.md           (project, git-tracked)
 *  3. <cwd>/AGENT.md                    (directory-specific)
 *  4. <project-root>/AGENT.local.md     (personal, gitignored)
 *  5. .agent/rules/*.md                 (glob-scoped rules)
 *
 * Files are auto-loaded at session start, injected into the system prompt,
 * and survive compaction (re-read from disk on rehydration).
 *
 * Budget: max ~10 000 tokens total (~200 lines per file).
 */

import * as fs from "fs";
import * as path from "path";
import { getConfigDir } from "../config/paths.js";

export interface AgentFileEntry {
  source: string;   // human-readable origin (e.g. "global", "project", "rule:frontend")
  path: string;     // absolute file path
  content: string;
  glob?: string;    // optional glob scope from frontmatter
}

/** Approximate token count (1 token ≈ 4 chars for English). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const MAX_TOKENS = 10_000;
const MAX_LINES_PER_FILE = 200;

/**
 * Parse optional YAML-ish frontmatter for glob scope.
 *
 * Example:
 * ```
 * ---
 * glob: src/** /*.tsx
 * ---
 * Use React hooks, not class components.
 * ```
 */
function parseFrontmatter(content: string): { glob?: string; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { body: content };

  const frontmatter = match[1];
  const body = match[2];
  const globMatch = frontmatter.match(/^glob:\s*(.+)$/m);
  return { glob: globMatch?.[1].trim(), body };
}

function readFileIfExists(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    if (lines.length > MAX_LINES_PER_FILE) {
      return lines.slice(0, MAX_LINES_PER_FILE).join("\n") + "\n...(truncated)";
    }
    return content;
  } catch {
    return null;
  }
}

/**
 * Load all AGENT.md files from the hierarchy.
 *
 * @param projectRoot  The root of the project (typically cwd or git root).
 * @param cwd          The current working directory (may be a subdirectory).
 */
export function loadAgentFiles(
  projectRoot: string = process.cwd(),
  cwd: string = process.cwd()
): AgentFileEntry[] {
  const entries: AgentFileEntry[] = [];
  let totalTokens = 0;

  function tryAdd(source: string, filePath: string, glob?: string): void {
    const content = readFileIfExists(filePath);
    if (!content) return;
    const tokens = estimateTokens(content);
    if (totalTokens + tokens > MAX_TOKENS) return; // budget exceeded
    totalTokens += tokens;
    entries.push({ source, path: filePath, content, glob });
  }

  // 1. Global
  const globalPath = path.join(getConfigDir(), "AGENT.md");
  tryAdd("global", globalPath);

  // 2. Project root
  const projectAgentMd = path.join(projectRoot, "AGENT.md");
  tryAdd("project", projectAgentMd);

  // 3. Directory-specific (only if cwd differs from projectRoot)
  if (path.resolve(cwd) !== path.resolve(projectRoot)) {
    const dirAgentMd = path.join(cwd, "AGENT.md");
    tryAdd(`dir:${path.relative(projectRoot, cwd)}`, dirAgentMd);
  }

  // 4. Local (personal, gitignored)
  const localAgentMd = path.join(projectRoot, "AGENT.local.md");
  tryAdd("local", localAgentMd);

  // 5. Glob-scoped rules from .agent/rules/
  const rulesDir = path.join(projectRoot, ".agent", "rules");
  if (fs.existsSync(rulesDir)) {
    try {
      const files = fs.readdirSync(rulesDir).filter(f => f.endsWith(".md")).sort();
      for (const file of files) {
        const filePath = path.join(rulesDir, file);
        const raw = readFileIfExists(filePath);
        if (!raw) continue;
        const { glob, body } = parseFrontmatter(raw);
        const tokens = estimateTokens(body);
        if (totalTokens + tokens > MAX_TOKENS) break;
        totalTokens += tokens;
        entries.push({
          source: `rule:${path.basename(file, ".md")}`,
          path: filePath,
          content: body,
          glob,
        });
      }
    } catch {
      // Can't read rules directory
    }
  }

  return entries;
}

/**
 * Build a combined system prompt section from agent files.
 *
 * Only includes rules whose glob matches at least one file in `activeFiles`.
 * Rules without a glob are always included.
 */
export function buildAgentPrompt(
  entries: AgentFileEntry[],
  activeFiles?: string[]
): string {
  const sections: string[] = [];

  for (const entry of entries) {
    // If entry has a glob scope and we have activeFiles, filter
    if (entry.glob && activeFiles) {
      const pattern = entry.glob;
      const matches = activeFiles.some(f => matchGlob(f, pattern));
      if (!matches) continue;
    }

    sections.push(`# [${entry.source}]\n${entry.content}`);
  }

  return sections.join("\n\n");
}

/** Minimal glob matching (supports * and **). */
function matchGlob(filePath: string, pattern: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "§DOUBLESTAR§")
    .replace(/\*/g, "[^/]*")
    .replace(/§DOUBLESTAR§/g, ".*");
  return new RegExp(`^${regex}$`).test(filePath);
}
