/**
 * batch-edit.ts — Transactional multi-file editor.
 *
 * Applies multiple file edits atomically: if any edit fails,
 * no files are modified. Creates backup of originals for safety.
 *
 * Reference: Phase 2.3 — Multi-File Atomic Edits
 */

import * as diff from "diff";
import { readFile, writeFile } from "./file-ops.js";

export interface BatchEditOperation {
  path: string;
  old_text: string;
  new_text: string;
}

export interface BatchEditResult {
  ok: boolean;
  applied: number;
  failed: number;
  errors: string[];
  diffs: Array<{ path: string; diff: string }>;
  backups: Map<string, string>;
}

export class BatchEditor {
  /**
   * Apply multiple edits atomically.
   * All edits are validated in memory first; if any fail, nothing is written.
   */
  async apply(operations: BatchEditOperation[]): Promise<BatchEditResult> {
    const errors: string[] = [];
    const originals = new Map<string, string>();
    const modified = new Map<string, string>();
    const diffs: Array<{ path: string; diff: string }> = [];

    // Phase 1: Read all files and validate all edits in memory
    for (const op of operations) {
      try {
        if (!originals.has(op.path)) {
          const content = await readFile(op.path);
          originals.set(op.path, content);
          modified.set(op.path, content);
        }

        const current = modified.get(op.path)!;
        if (!current.includes(op.old_text)) {
          errors.push(`${op.path}: old_text not found in file`);
          continue;
        }

        const occurrences = current.split(op.old_text).length - 1;
        if (occurrences > 1) {
          errors.push(`${op.path}: old_text found ${occurrences} times (ambiguous)`);
          continue;
        }

        modified.set(op.path, current.replace(op.old_text, op.new_text));
      } catch (err: any) {
        errors.push(`${op.path}: ${err.message}`);
      }
    }

    // Phase 2: If any errors, abort entirely
    if (errors.length > 0) {
      return { ok: false, applied: 0, failed: errors.length, errors, diffs: [], backups: originals };
    }

    // Phase 3: Generate diffs
    for (const [filePath, newContent] of modified) {
      const original = originals.get(filePath)!;
      if (original !== newContent) {
        const diffOutput = diff.createPatch(filePath, original, newContent);
        diffs.push({ path: filePath, diff: diffOutput });
      }
    }

    // Phase 4: Write all files
    for (const [filePath, newContent] of modified) {
      const original = originals.get(filePath)!;
      if (original !== newContent) {
        await writeFile(filePath, newContent);
      }
    }

    return {
      ok: true,
      applied: diffs.length,
      failed: 0,
      errors: [],
      diffs,
      backups: originals,
    };
  }

  /**
   * Rollback files to their original content.
   */
  async rollback(backups: Map<string, string>): Promise<void> {
    for (const [filePath, content] of backups) {
      await writeFile(filePath, content);
    }
  }
}
