/**
 * Simple unified diff generation for showing file changes.
 */

import { createTwoFilesPatch } from "diff";

export interface DiffLine {
  type: "add" | "remove" | "context";
  content: string;
  lineNumber: number;
}

export function generateDiff(original: string, modified: string, filename: string): string {
  // Use professional diff package instead of naive line-by-line comparison
  return createTwoFilesPatch(`a/${filename}`, `b/${filename}`, original, modified);
}
