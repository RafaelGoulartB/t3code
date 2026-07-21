export interface FileFindMatch {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly lineNumber: number;
  readonly startColumn: number;
  readonly endColumn: number;
}

export interface FileFindShortcutEvent {
  readonly code?: string;
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

export type FileFindDirection = "next" | "previous";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findLineMatches(
  line: string,
  queryExpression: RegExp,
  lineNumber: number,
  lineOffset: number,
): FileFindMatch[] {
  const matches: FileFindMatch[] = [];
  for (const match of line.matchAll(queryExpression)) {
    const startColumn = match.index;
    const matchText = match[0];
    if (startColumn === undefined || matchText.length === 0) continue;
    matches.push({
      startOffset: lineOffset + startColumn,
      endOffset: lineOffset + startColumn + matchText.length,
      lineNumber,
      startColumn,
      endColumn: startColumn + matchText.length,
    });
  }
  return matches;
}

/** Finds literal, case-insensitive, non-overlapping matches within individual file lines. */
export function findFileMatches(contents: string, query: string): FileFindMatch[] {
  if (query.length === 0) return [];

  const queryExpression = new RegExp(escapeRegExp(query), "giu");
  const matches: FileFindMatch[] = [];
  let lineNumber = 1;
  let lineOffset = 0;
  let cursor = 0;

  while (cursor <= contents.length) {
    let lineEnd = cursor;
    while (
      lineEnd < contents.length &&
      contents.charCodeAt(lineEnd) !== 10 &&
      contents.charCodeAt(lineEnd) !== 13
    ) {
      lineEnd += 1;
    }

    matches.push(
      ...findLineMatches(contents.slice(cursor, lineEnd), queryExpression, lineNumber, lineOffset),
    );

    if (lineEnd === contents.length) break;
    if (contents.charCodeAt(lineEnd) === 13 && contents.charCodeAt(lineEnd + 1) === 10) {
      lineEnd += 1;
    }
    cursor = lineEnd + 1;
    lineOffset = cursor;
    lineNumber += 1;
  }

  return matches;
}

export function navigateFileFindIndex(
  currentIndex: number | null,
  matchCount: number,
  direction: FileFindDirection,
): number | null {
  if (matchCount === 0) return null;
  if (currentIndex === null) return direction === "previous" ? matchCount - 1 : 0;
  if (direction === "previous") return (currentIndex - 1 + matchCount) % matchCount;
  return (currentIndex + 1) % matchCount;
}

export function reconcileFileFindIndex<T extends { startOffset: number; endOffset: number }>(
  previousMatches: readonly T[],
  nextMatches: readonly T[],
  previousIndex: number | null,
): number | null {
  if (nextMatches.length === 0) return null;
  if (previousIndex === null) return 0;

  const previousMatch = previousMatches[previousIndex];
  if (previousMatch) {
    const preservedIndex = nextMatches.findIndex(
      (match) =>
        match.startOffset === previousMatch.startOffset &&
        match.endOffset === previousMatch.endOffset,
    );
    if (preservedIndex >= 0) return preservedIndex;
  }

  return Math.min(previousIndex, nextMatches.length - 1);
}

function isMacLikePlatform(platform: string): boolean {
  return /^(Mac|iPhone|iPad|iPod)/i.test(platform);
}

export function isFileFindShortcut(event: FileFindShortcutEvent, platform: string): boolean {
  const isF = event.key.toLowerCase() === "f" || event.code === "KeyF";
  if (!isF || event.altKey || event.shiftKey) return false;
  return isMacLikePlatform(platform)
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

export interface SearchableTextSegment<T> {
  readonly value: string;
  readonly target: T;
}

export interface SearchableTextMatch<T> {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly startTarget: T;
  readonly startTargetOffset: number;
  readonly endTarget: T;
  readonly endTargetOffset: number;
}

/**
 * Maps matches in a flattened text stream back to the source segments. A null
 * segment is a hard boundary that matches may not cross.
 */
export function findSearchableTextMatches<T>(
  segments: readonly (SearchableTextSegment<T> | null)[],
  query: string,
): SearchableTextMatch<T>[] {
  if (query.length === 0) return [];

  const matches: SearchableTextMatch<T>[] = [];
  let absoluteOffset = 0;
  let run: Array<SearchableTextSegment<T> & { start: number; end: number }> = [];

  const flushRun = () => {
    if (run.length === 0) return;
    const runText = run.map((segment) => segment.value).join("");
    const expression = new RegExp(escapeRegExp(query), "giu");
    for (const match of runText.matchAll(expression)) {
      const localStart = match.index;
      const matchText = match[0];
      if (localStart === undefined || matchText.length === 0) continue;
      const localEnd = localStart + matchText.length;
      const startSegment = run.find(
        (segment) => localStart >= segment.start && localStart < segment.end,
      );
      const endSegment = run.find((segment) => localEnd > segment.start && localEnd <= segment.end);
      if (!startSegment || !endSegment) continue;
      matches.push({
        startOffset: absoluteOffset + localStart,
        endOffset: absoluteOffset + localEnd,
        startTarget: startSegment.target,
        startTargetOffset: localStart - startSegment.start,
        endTarget: endSegment.target,
        endTargetOffset: localEnd - endSegment.start,
      });
    }
    absoluteOffset += runText.length + 1;
    run = [];
  };

  for (const segment of segments) {
    if (segment === null) {
      flushRun();
      continue;
    }
    if (segment.value.length === 0) continue;
    const start = run.at(-1)?.end ?? 0;
    run.push({ ...segment, start, end: start + segment.value.length });
  }
  flushRun();

  return matches;
}
