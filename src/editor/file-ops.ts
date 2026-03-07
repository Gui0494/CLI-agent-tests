import * as fs from "fs/promises";
import * as path from "path";

const WORKSPACE_ROOT = path.resolve(process.cwd());
const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  ".venv",
  "venv",
  "__pycache__",
]);

function resolveWorkspacePath(targetPath: string): string {
  const resolved = path.resolve(WORKSPACE_ROOT, targetPath);
  const relative = path.relative(WORKSPACE_ROOT, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace: ${targetPath}`);
  }

  return resolved;
}

export async function readFile(filePath: string): Promise<string> {
  return fs.readFile(resolveWorkspacePath(filePath), "utf-8");
}

export async function writeFile(filePath: string, content: string): Promise<void> {
  const resolved = resolveWorkspacePath(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, "utf-8");
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(resolveWorkspacePath(filePath));
    return true;
  } catch {
    return false;
  }
}

export async function listFiles(dir = ".", pattern?: RegExp): Promise<string[]> {
  const startDir = resolveWorkspacePath(dir);
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(WORKSPACE_ROOT, absolute);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(absolute);
        continue;
      }

      if (!pattern || pattern.test(relative)) {
        results.push(relative);
      }
    }
  }

  await walk(startDir);
  return results;
}

export async function patchFile(filePath: string, oldText: string, newText: string): Promise<boolean> {
  const content = await readFile(filePath);
  const firstIndex = content.indexOf(oldText);

  if (firstIndex === -1) return false;

  const secondIndex = content.indexOf(oldText, firstIndex + oldText.length);
  if (secondIndex !== -1) {
    throw new Error("Patch target is ambiguous; multiple matches found");
  }

  const patched =
    content.slice(0, firstIndex) +
    newText +
    content.slice(firstIndex + oldText.length);

  await writeFile(filePath, patched);
  return true;
}
