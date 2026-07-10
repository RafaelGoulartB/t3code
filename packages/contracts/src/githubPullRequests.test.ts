import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  GitHubPullRequestAction,
  GitHubPullRequestListInput,
  GitHubPullRequestListResult,
} from "./githubPullRequests.ts";

const decodeListInput = Schema.decodeUnknownSync(GitHubPullRequestListInput);
const decodeAction = Schema.decodeUnknownSync(GitHubPullRequestAction);
const decodeListResult = Schema.decodeUnknownSync(GitHubPullRequestListResult);

describe("GitHub pull request contracts", () => {
  it("accepts advanced list filters", () => {
    const parsed = decodeListInput({
      preset: "checks_failed",
      state: "open",
      organization: "octo",
      review: "required",
      checks: "failure",
      limit: 50,
    });

    expect(parsed.organization).toBe("octo");
    expect(parsed.checks).toBe("failure");
  });

  it("keeps actions typed and repository-scoped", () => {
    const parsed = decodeAction({
      repository: "octo/repo",
      number: 42,
      kind: "merge",
      strategy: "squash",
      auto: true,
    });

    expect(parsed.kind).toBe("merge");
    expect(parsed.repository).toBe("octo/repo");
  });

  it("decodes an empty result without inventing PRs", () => {
    const parsed = decodeListResult({ items: [], limit: 50, truncated: false });
    expect(parsed.items).toHaveLength(0);
  });
});
