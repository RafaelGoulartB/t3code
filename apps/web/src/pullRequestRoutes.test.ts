import { describe, expect, it } from "vite-plus/test";

import {
  clearPullRequestFilters,
  parsePullRequestSearch,
  pullRequestSearchToInput,
  resolvePullRequestSearch,
} from "./pullRequestRoutes";

describe("pullRequestRoutes", () => {
  it("normalizes advanced filters and preserves them as gh input", () => {
    const search = resolvePullRequestSearch(
      parsePullRequestSearch({
        preset: "review_requested",
        organization: "octo",
        repository: "octo/repo",
        checks: "failure",
        review: "required",
        limit: 999,
      }),
    );

    expect(search.limit).toBe(100);
    expect(pullRequestSearchToInput(search)).toMatchObject({
      preset: "review_requested",
      organization: "octo",
      repository: "octo/repo",
      checks: "failure",
      review: "required",
    });
  });

  it("resets filters without changing the selected environment", () => {
    const search = parsePullRequestSearch({
      environment: "environment-1",
      preset: "mine",
      organization: "octo",
      query: "bug",
    });

    expect(clearPullRequestFilters(search)).toMatchObject({
      environment: "environment-1",
      preset: "all",
      state: "open",
    });
  });
});
