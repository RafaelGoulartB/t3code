import { describe, expect, it } from "vite-plus/test";

import { formatRelativeGitCommitDate } from "./GitLogDialog.logic";

describe("formatRelativeGitCommitDate", () => {
  it("formats a past timestamp relative to the supplied clock", () => {
    expect(formatRelativeGitCommitDate("2026-07-11T11:58:00.000Z", Date.UTC(2026, 6, 11, 12))).toBe(
      "2 minutes ago",
    );
  });

  it("returns a stable fallback for malformed dates", () => {
    expect(formatRelativeGitCommitDate("not-a-date", 0)).toBe("Unknown date");
  });
});
