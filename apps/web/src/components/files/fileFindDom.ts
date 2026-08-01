import {
  findSearchableTextMatches,
  type FileFindMatch,
  type SearchableTextMatch,
  type SearchableTextSegment,
} from "./fileFind";

export const FILE_FIND_MATCH_HIGHLIGHT = "t3-file-find-match";
export const FILE_FIND_CURRENT_HIGHLIGHT = "t3-file-find-current";

interface HighlightRegistryLike {
  delete(name: string): boolean;
  set(name: string, highlight: unknown): void;
}

interface HighlightConstructorLike {
  new (...ranges: Range[]): unknown;
}

function getHighlightApi(): {
  registry: HighlightRegistryLike;
  HighlightConstructor: HighlightConstructorLike;
} | null {
  const css = globalThis.CSS as (typeof CSS & { highlights?: HighlightRegistryLike }) | undefined;
  const HighlightConstructor = (
    globalThis as typeof globalThis & {
      Highlight?: HighlightConstructorLike;
    }
  ).Highlight;
  if (!css?.highlights || !HighlightConstructor) return null;
  return { registry: css.highlights, HighlightConstructor };
}

export function clearFileFindHighlights(): void {
  const api = getHighlightApi();
  if (!api) return;
  api.registry.delete(FILE_FIND_MATCH_HIGHLIGHT);
  api.registry.delete(FILE_FIND_CURRENT_HIGHLIGHT);
}

export function applyFileFindHighlights(
  ranges: readonly Range[],
  currentRange: Range | null,
): void {
  const api = getHighlightApi();
  if (!api) return;

  api.registry.delete(FILE_FIND_MATCH_HIGHLIGHT);
  api.registry.delete(FILE_FIND_CURRENT_HIGHLIGHT);
  if (ranges.length > 0) {
    api.registry.set(FILE_FIND_MATCH_HIGHLIGHT, new api.HighlightConstructor(...ranges));
  }
  if (currentRange) {
    api.registry.set(FILE_FIND_CURRENT_HIGHLIGHT, new api.HighlightConstructor(currentRange));
  }
}

function textPositionAt(
  root: Node,
  requestedOffset: number,
): { node: Text; offset: number } | null {
  const walker = root.ownerDocument?.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  if (!walker) return null;
  let remaining = requestedOffset;
  let lastTextNode: Text | null = null;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text;
    lastTextNode = textNode;
    const length = textNode.data.length;
    if (remaining <= length) return { node: textNode, offset: remaining };
    remaining -= length;
  }

  return lastTextNode && remaining === 0
    ? { node: lastTextNode, offset: lastTextNode.data.length }
    : null;
}

export function createCodeMatchRanges(
  root: ParentNode,
  matches: readonly FileFindMatch[],
): Map<number, Range> {
  const ranges = new Map<number, Range>();
  for (const [index, match] of matches.entries()) {
    const line = root.querySelector<HTMLElement>(`[data-line="${match.lineNumber}"]`);
    if (!line) continue;
    const start = textPositionAt(line, match.startColumn);
    const end = textPositionAt(line, match.endColumn);
    if (!start || !end) continue;
    const range = line.ownerDocument.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    ranges.set(index, range);
  }
  return ranges;
}

const BLOCK_ELEMENTS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DIV",
  "DL",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TR",
  "UL",
]);

const EXCLUDED_SELECTOR = [
  "button",
  "input",
  "select",
  "textarea",
  "script",
  "style",
  "svg",
  "[hidden]",
  "[aria-hidden='true']",
  "[data-file-find-ignore]",
  ".sr-only",
].join(",");

function appendBoundary(segments: Array<SearchableTextSegment<Text> | null>): void {
  if (segments.length > 0 && segments.at(-1) !== null) segments.push(null);
}

export function collectSearchableTextSegments(
  root: ParentNode,
): Array<SearchableTextSegment<Text> | null> {
  const segments: Array<SearchableTextSegment<Text> | null> = [];

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text;
      if (textNode.data.length > 0) segments.push({ value: textNode.data, target: textNode });
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.matches(EXCLUDED_SELECTOR)) {
      appendBoundary(segments);
      return;
    }

    const isBlock = BLOCK_ELEMENTS.has(node.tagName);
    if (isBlock) appendBoundary(segments);
    for (const child of node.childNodes) visit(child);
    if (isBlock) appendBoundary(segments);
  };

  for (const child of root.childNodes) visit(child);
  if (segments.at(-1) === null) segments.pop();
  return segments;
}

export interface DomFileFindMatch extends SearchableTextMatch<Text> {
  readonly range: Range;
}

export function createDomFileFindMatches(root: ParentNode, query: string): DomFileFindMatch[] {
  return findSearchableTextMatches(collectSearchableTextSegments(root), query).map((match) => {
    const range = match.startTarget.ownerDocument.createRange();
    range.setStart(match.startTarget, match.startTargetOffset);
    range.setEnd(match.endTarget, match.endTargetOffset);
    return { ...match, range };
  });
}

export function scrollRangeIntoView(range: Range): void {
  const target =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  target?.scrollIntoView({ block: "center", inline: "nearest" });
}
