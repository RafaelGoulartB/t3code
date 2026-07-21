import { describe, expect, it } from "vite-plus/test";

import {
  findFileMatches,
  findSearchableTextMatches,
  isFileFindShortcut,
  navigateFileFindIndex,
  reconcileFileFindIndex,
} from "./fileFind";

describe("findFileMatches", () => {
  it("finds literal case-insensitive matches with line and offset coordinates", () => {
    expect(findFileMatches("Needle needle\nother NEEDLE", "needle")).toEqual([
      {
        startOffset: 0,
        endOffset: 6,
        lineNumber: 1,
        startColumn: 0,
        endColumn: 6,
      },
      {
        startOffset: 7,
        endOffset: 13,
        lineNumber: 1,
        startColumn: 7,
        endColumn: 13,
      },
      {
        startOffset: 20,
        endOffset: 26,
        lineNumber: 2,
        startColumn: 6,
        endColumn: 12,
      },
    ]);
  });

  it("handles CRLF, unicode, regex punctuation, empty queries, and no results", () => {
    expect(findFileMatches("CAFÉ\r\ncafé", "café").map((match) => match.lineNumber)).toEqual([
      1, 2,
    ]);
    expect(findFileMatches("a+b aab a+b", "a+b")).toHaveLength(2);
    expect(findFileMatches("anything", "")).toEqual([]);
    expect(findFileMatches("anything", "missing")).toEqual([]);
  });
});

describe("file find navigation", () => {
  it("wraps in both directions", () => {
    expect(navigateFileFindIndex(null, 3, "next")).toBe(0);
    expect(navigateFileFindIndex(null, 3, "previous")).toBe(2);
    expect(navigateFileFindIndex(2, 3, "next")).toBe(0);
    expect(navigateFileFindIndex(0, 3, "previous")).toBe(2);
    expect(navigateFileFindIndex(0, 0, "next")).toBeNull();
  });

  it("preserves an existing occurrence after content changes and otherwise clamps", () => {
    const previous = findFileMatches("one two two", "two");
    const inserted = findFileMatches("zero one two two", "two");
    expect(reconcileFileFindIndex(previous, inserted, 1)).toBe(1);

    const removed = findFileMatches("one two", "two");
    expect(reconcileFileFindIndex(previous, removed, 1)).toBe(0);
    expect(reconcileFileFindIndex(previous, [], 1)).toBeNull();
  });
});

describe("isFileFindShortcut", () => {
  const event = (overrides: Partial<Parameters<typeof isFileFindShortcut>[0]> = {}) => ({
    key: "f",
    code: "KeyF",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  });

  it("uses Ctrl on Windows/Linux and Cmd on macOS", () => {
    expect(isFileFindShortcut(event({ ctrlKey: true }), "Win32")).toBe(true);
    expect(isFileFindShortcut(event({ ctrlKey: true }), "Linux x86_64")).toBe(true);
    expect(isFileFindShortcut(event({ metaKey: true }), "MacIntel")).toBe(true);
  });

  it("rejects modified and wrong-platform shortcuts", () => {
    expect(isFileFindShortcut(event({ ctrlKey: true }), "MacIntel")).toBe(false);
    expect(isFileFindShortcut(event({ metaKey: true }), "Win32")).toBe(false);
    expect(isFileFindShortcut(event({ ctrlKey: true, shiftKey: true }), "Win32")).toBe(false);
    expect(isFileFindShortcut(event({ ctrlKey: true, altKey: true }), "Win32")).toBe(false);
  });
});

describe("findSearchableTextMatches", () => {
  it("maps a match across inline segments", () => {
    const first = { id: "first" };
    const second = { id: "second" };
    expect(
      findSearchableTextMatches(
        [
          { value: "hello ", target: first },
          { value: "world", target: second },
        ],
        "lo wo",
      ),
    ).toEqual([
      {
        startOffset: 3,
        endOffset: 8,
        startTarget: first,
        startTargetOffset: 3,
        endTarget: second,
        endTargetOffset: 2,
      },
    ]);
  });

  it("does not match across excluded or block boundaries", () => {
    expect(
      findSearchableTextMatches(
        [{ value: "hello", target: 1 }, null, { value: "world", target: 2 }],
        "helloworld",
      ),
    ).toEqual([]);
  });
});
