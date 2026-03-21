/**
 * fuzzy-edit.ts — Fuzzy text matching for edit operations.
 *
 * When an exact match for old_text fails, this module attempts a fuzzy
 * match by sliding a window over the file content and computing edit
 * distance. Handles whitespace differences, minor typos, and indentation.
 *
 * Reference: Phase 5.2 — Fuzzy Edit Matching
 */

export interface FuzzyMatch {
  index: number;
  match: string;
  distance: number;
}

/**
 * Compute Levenshtein edit distance between two strings.
 * Uses optimized single-row algorithm for memory efficiency.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Short-circuit if strings are too different in length
  const lenDiff = Math.abs(a.length - b.length);
  if (lenDiff > Math.max(a.length, b.length) * 0.3) return lenDiff;

  const bLen = b.length;
  let prev = new Array(bLen + 1);
  let curr = new Array(bLen + 1);

  for (let j = 0; j <= bLen; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[bLen];
}

/**
 * Normalize whitespace for comparison: collapse runs of whitespace to single space.
 */
function normalizeWhitespace(s: string): string {
  return s.replace(/[ \t]+/g, " ").replace(/\r\n/g, "\n");
}

/**
 * Find the best fuzzy match for `target` within `content`.
 *
 * @param content - The full file content to search in
 * @param target - The text to find (may have minor differences)
 * @param maxDistance - Maximum edit distance to accept (default: 10% of target length, min 5)
 * @returns The best match if within maxDistance, or null
 */
export function fuzzyFind(
  content: string,
  target: string,
  maxDistance?: number,
): FuzzyMatch | null {
  const threshold = maxDistance ?? Math.max(5, Math.floor(target.length * 0.1));

  // First try: normalize whitespace and check
  const normalizedContent = normalizeWhitespace(content);
  const normalizedTarget = normalizeWhitespace(target);

  if (normalizedContent.includes(normalizedTarget)) {
    // Find the original substring that matches the normalized version
    const normIdx = normalizedContent.indexOf(normalizedTarget);
    // Map back to original content by counting characters
    let origIdx = 0;
    let normCount = 0;
    while (normCount < normIdx && origIdx < content.length) {
      // Skip extra whitespace that was collapsed
      if (/[ \t]/.test(content[origIdx]) && origIdx + 1 < content.length && /[ \t]/.test(content[origIdx + 1])) {
        origIdx++;
        continue;
      }
      origIdx++;
      normCount++;
    }
    // Find the end of the match
    let endOrig = origIdx;
    let matchLen = 0;
    while (matchLen < normalizedTarget.length && endOrig < content.length) {
      if (/[ \t]/.test(content[endOrig]) && endOrig + 1 < content.length && /[ \t]/.test(content[endOrig + 1])) {
        endOrig++;
        continue;
      }
      endOrig++;
      matchLen++;
    }
    const match = content.substring(origIdx, endOrig);
    return { index: origIdx, match, distance: 0 };
  }

  // Second try: sliding window with edit distance
  const lines = content.split("\n");
  const targetLines = target.split("\n");
  const targetLineCount = targetLines.length;

  if (targetLineCount > lines.length) return null;

  let bestMatch: FuzzyMatch | null = null;
  let bestDist = threshold + 1;

  for (let i = 0; i <= lines.length - targetLineCount; i++) {
    const windowLines = lines.slice(i, i + targetLineCount);
    const windowText = windowLines.join("\n");

    const dist = editDistance(
      normalizeWhitespace(windowText),
      normalizedTarget,
    );

    if (dist < bestDist) {
      bestDist = dist;
      // Calculate the actual index in the original content
      const precedingLines = lines.slice(0, i);
      const index = precedingLines.length === 0
        ? 0
        : precedingLines.join("\n").length + 1;
      bestMatch = { index, match: windowText, distance: dist };
    }
  }

  return bestMatch;
}
