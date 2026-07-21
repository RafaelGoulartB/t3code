import { describe, expect, it } from "vite-plus/test";

import { normalizeWorktreePath } from "./worktreePath.ts";

describe("normalizeWorktreePath", () => {
  it("normalizes separators and case for Windows paths", () => {
    expect(normalizeWorktreePath(" C:\\Projects\\Demo\\ ")).toBe("c:/projects/demo");
  });

  it("preserves case for POSIX paths", () => {
    expect(normalizeWorktreePath("/Users/Dev/Project/")).toBe("/Users/Dev/Project");
  });

  it("returns null for an empty path", () => {
    expect(normalizeWorktreePath("  ")).toBeNull();
  });
});
