/**
 * Simple unified diff generation for showing file changes.
 */

export interface DiffLine {
  type: "add" | "remove" | "context";
  content: string;
  lineNumber: number;
}

export function generateDiff(original: string, modified: string, filename: string): string {
  const origLines = original.split("\n");
  const modLines = modified.split("\n");

  const header = [
    `--- a/${filename}`,
    `+++ b/${filename}`,
  ];

  const changes: string[] = [];
  const maxLen = Math.max(origLines.length, modLines.length);

  for (let i = 0; i < maxLen; i++) {
    const orig = origLines[i];
    const mod = modLines[i];

    if (orig === undefined) {
      changes.push(`+${mod}`);
    } else if (mod === undefined) {
      changes.push(`-${orig}`);
    } else if (orig !== mod) {
      changes.push(`-${orig}`);
      changes.push(`+${mod}`);
    } else {
      changes.push(` ${orig}`);
    }
  }

  return [...header, `@@ -1,${origLines.length} +1,${modLines.length} @@`, ...changes].join("\n");
}
