import { assert, it, afterEach, describe, expect, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import { ChildProcessSpawner } from "effect/unstable/process";
import { VcsProcessExitError, VcsProcessSpawnError } from "@t3tools/contracts";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitHubCli from "./GitHubCli.ts";

const processOutput = (stdout: string): VcsProcess.VcsProcessOutput => ({
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

const mockRun = vi.fn<VcsProcess.VcsProcess["Service"]["run"]>();

const layer = GitHubCli.layer.pipe(
  Layer.provide(
    Layer.mock(VcsProcess.VcsProcess)({
      run: mockRun,
    }),
  ),
);

afterEach(() => {
  mockRun.mockReset();
});

describe("GitHubCli.layer", () => {
  it.effect("searches global pull requests with preset and organization filters", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              data: {
                search: {
                  nodes: [
                    {
                      number: 7,
                      title: "Fix CI",
                      url: "https://github.com/octo/repo/pull/7",
                      repository: { nameWithOwner: "octo/repo" },
                      author: { login: "octocat" },
                      state: "OPEN",
                      isDraft: false,
                      createdAt: "2026-07-09T00:00:00Z",
                      updatedAt: "2026-07-10T00:00:00Z",
                      labels: [],
                      reviewDecision: "APPROVED",
                      statusCheckRollup: { state: "SUCCESS" },
                    },
                  ],
                },
              },
            }),
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.searchPullRequests({
        cwd: "/repo",
        filters: {
          preset: "checks_failed",
          state: "open",
          organization: "octo",
          limit: 25,
          sort: "updated",
        },
      });

      assert.equal(result.items[0]?.repository, "octo/repo");
      assert.equal(result.items[0]?.ciStatus, "success");
      assert.equal(result.items[0]?.reviewStatus, "approved");
      const firstCall = mockRun.mock.calls[0]?.[0];
      expect(firstCall).toMatchObject({
        operation: "GitHubCli.execute",
        command: "gh",
        cwd: "/repo",
        timeoutMs: 30_000,
      });
      expect(firstCall?.args).toEqual(
        expect.arrayContaining(["api", "graphql", "-f", expect.stringContaining("query=")]),
      );
      expect(firstCall?.args.join(" ")).toContain("org:octo");
      expect(firstCall?.args.join(" ")).toContain("status:failure");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("searches involved pull requests by title in GraphQL and fallback modes", () =>
    Effect.gen(function* () {
      const filters = {
        preset: "involvement" as const,
        state: "open" as const,
        query: "Improve search",
        sort: "best-match" as const,
        limit: 20,
      };
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const graphqlResponse = JSON.stringify({
        data: {
          search: {
            nodes: [
              {
                number: 12,
                title: "Improve search results",
                url: "https://github.com/octo/repo/pull/12",
                repository: { nameWithOwner: "octo/repo" },
                author: { login: "octocat" },
                state: "OPEN",
                isDraft: false,
                labels: [],
                reviewDecision: null,
                statusCheckRollup: { state: "SUCCESS" },
              },
            ],
          },
        },
      });

      mockRun.mockReturnValueOnce(Effect.succeed(processOutput(graphqlResponse)));
      const gh = yield* GitHubCli.GitHubCli;
      const graphqlResult = yield* gh.searchPullRequests({ cwd: "/repo", filters });
      assert.equal(graphqlResult.items[0]?.title, "Improve search results");
      const graphqlArgs = mockRun.mock.calls[0]?.[0].args.join(" ") ?? "";
      expect(graphqlArgs).toContain("involves:@me");
      expect(graphqlArgs).toContain("Improve search in:title");

      mockRun.mockReset();
      mockRun.mockReturnValueOnce(
        Effect.fail(
          new VcsProcessExitError({
            operation: "GitHubCli.execute",
            command: "gh api graphql",
            cwd: "/repo",
            exitCode: 1,
            failureKind: "command-failed",
            detail: "GraphQL unavailable",
          }),
        ),
      );
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify([
              {
                number: 12,
                title: "Improve search results",
                url: "https://github.com/octo/repo/pull/12",
                repository: { nameWithOwner: "octo/repo" },
                author: { login: "octocat" },
                state: "OPEN",
                isDraft: false,
                labels: [],
              },
            ]),
          ),
        ),
      );

      const fallbackResult = yield* gh.searchPullRequests({ cwd: "/repo", filters });
      assert.equal(fallbackResult.items[0]?.title, "Improve search results");
      const fallbackArgs = mockRun.mock.calls[1]?.[0].args.join(" ") ?? "";
      expect(fallbackArgs).toContain("Improve search in:title");
      expect(fallbackArgs).toContain("--involves @me");
      expect(fallbackArgs).toContain("--state open");
      expect(fallbackArgs).toContain("--sort best-match");
      expect(fallbackArgs).toContain("--limit 20");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("aggregates CI and review status for list cards", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              data: {
                search: {
                  nodes: [
                    {
                      number: 8,
                      title: "Failed checks",
                      url: "https://github.com/octo/repo/pull/8",
                      repository: { nameWithOwner: "octo/repo" },
                      author: { login: "octocat" },
                      state: "OPEN",
                      isDraft: false,
                      labels: [],
                      reviewDecision: "CHANGES_REQUESTED",
                      statusCheckRollup: { state: "FAILURE" },
                    },
                    {
                      number: 9,
                      title: "Waiting for review",
                      url: "https://github.com/octo/repo/pull/9",
                      repository: { nameWithOwner: "octo/repo" },
                      author: { login: "octocat" },
                      state: "OPEN",
                      isDraft: false,
                      labels: [],
                      reviewDecision: "REVIEW_REQUIRED",
                      statusCheckRollup: { state: "PENDING" },
                    },
                  ],
                },
              },
            }),
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.searchPullRequests({
        cwd: "/repo",
        filters: { preset: "mine", limit: 10 },
      });

      assert.deepStrictEqual(
        result.items.map((item) => ({ ciStatus: item.ciStatus, reviewStatus: item.reviewStatus })),
        [
          { ciStatus: "failure", reviewStatus: "changes_requested" },
          { ciStatus: "pending", reviewStatus: "pending" },
        ],
      );
    }).pipe(Effect.provide(layer)),
  );

  it.effect("parses GraphQL pull request details", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              data: {
                repository: {
                  pullRequest: {
                    number: 10,
                    title: "Detailed PR",
                    body: "Description",
                    url: "https://github.com/octo/repo/pull/10",
                    repository: { nameWithOwner: "octo/repo" },
                    author: { login: "octocat" },
                    state: "OPEN",
                    isDraft: false,
                    baseRefName: "main",
                    headRefName: "feature/details",
                    createdAt: "2026-07-10T00:00:00Z",
                    updatedAt: "2026-07-10T01:00:00Z",
                    mergedAt: null,
                    additions: 4,
                    deletions: 1,
                    changedFiles: 2,
                    reviewDecision: "REVIEW_REQUIRED",
                    mergeable: "MERGEABLE",
                    mergeStateStatus: "CLEAN",
                    labels: { nodes: [{ name: "bug", color: "red" }] },
                    assignees: { nodes: [] },
                    reviewRequests: { nodes: [] },
                    reviews: { nodes: [] },
                    reviewThreads: {
                      nodes: [
                        {
                          path: "src/main.ts",
                          line: 42,
                          originalLine: 40,
                          isResolved: false,
                          isOutdated: false,
                          comments: {
                            nodes: [
                              {
                                author: { login: "reviewer" },
                                body: "Please extract this helper.",
                                createdAt: "2026-07-10T01:30:00Z",
                              },
                            ],
                          },
                        },
                      ],
                    },
                    comments: { nodes: [] },
                    statusCheckRollup: {
                      contexts: {
                        nodes: [
                          {
                            __typename: "CheckRun",
                            name: "build",
                            status: "COMPLETED",
                            conclusion: "SUCCESS",
                            detailsUrl: "https://github.com/octo/repo/actions/runs/10",
                          },
                        ],
                      },
                    },
                  },
                },
              },
            }),
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.getPullRequestDetails({
        cwd: "/repo",
        reference: { repository: "octo/repo", number: 10 },
      });

      assert.equal(result.title, "Detailed PR");
      assert.equal(result.reviewDecision, "REVIEW_REQUIRED");
      assert.equal(result.checks[0]?.bucket, "pass");
      assert.equal(result.reviewThreads[0]?.path, "src/main.ts");
      assert.equal(result.reviewThreads[0]?.comments[0]?.body, "Please extract this helper.");
      expect(mockRun.mock.calls[0]?.[0].args).toEqual(
        expect.arrayContaining(["api", "graphql", "-F", "number=10"]),
      );
      expect(
        mockRun.mock.calls[0]?.[0].args.find((argument) => argument.startsWith("query=")),
      ).not.toContain("workflowName");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("maps pull request management actions to safe gh arguments", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput("")));
      const gh = yield* GitHubCli.GitHubCli;

      const result = yield* gh.runPullRequestAction({
        cwd: "/repo",
        action: {
          repository: "octo/repo",
          number: 7,
          kind: "merge",
          strategy: "squash",
          auto: true,
          matchHeadCommit: "abc123",
        },
      });

      assert.equal(result.kind, "merge");
      expect(mockRun).toHaveBeenCalledWith({
        operation: "GitHubCli.execute",
        command: "gh",
        args: [
          "pr",
          "merge",
          "7",
          "--repo",
          "octo/repo",
          "--squash",
          "--auto",
          "--match-head-commit",
          "abc123",
        ],
        cwd: "/repo",
        timeoutMs: 30_000,
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("maps pull request title and Markdown body edits to gh pr edit", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput("")));
      const gh = yield* GitHubCli.GitHubCli;

      const result = yield* gh.runPullRequestAction({
        cwd: "/repo",
        action: {
          repository: "octo/repo",
          number: 7,
          kind: "edit",
          title: "Updated title",
          body: "Summary\n\n## Changes\n- Keeps Markdown intact",
        },
      });

      assert.equal(result.kind, "edit");
      expect(mockRun).toHaveBeenCalledWith({
        operation: "GitHubCli.execute",
        command: "gh",
        args: [
          "pr",
          "edit",
          "7",
          "--repo",
          "octo/repo",
          "--title",
          "Updated title",
          "--body",
          "Summary\n\n## Changes\n- Keeps Markdown intact",
        ],
        cwd: "/repo",
        timeoutMs: 30_000,
      });
    }).pipe(Effect.provide(layer)),
  );

  it("does not classify a missing cwd as an unavailable gh executable", () => {
    const context = { command: "gh", cwd: "/repo" } as const;
    const missingCwd = new VcsProcessSpawnError({
      operation: "GitHubCli.execute",
      command: "gh",
      cwd: context.cwd,
      cause: PlatformError.systemError({
        _tag: "NotFound",
        module: "FileSystem",
        method: "access",
        pathOrDescriptor: context.cwd,
      }),
    });

    const commandFailure = GitHubCli.fromVcsError(context, missingCwd);

    assert.equal(commandFailure._tag, "GitHubCliCommandError");
    assert.strictEqual(commandFailure.cause, missingCwd);
    assert.notProperty(commandFailure, "operation");
  });

  it.effect("parses pull request view output", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              number: 42,
              title: "Add PR thread creation",
              url: "https://github.com/pingdotgg/codething-mvp/pull/42",
              baseRefName: "main",
              headRefName: "feature/pr-threads",
              state: "OPEN",
              mergedAt: null,
              isCrossRepository: true,
              headRepository: {
                nameWithOwner: "octocat/codething-mvp",
              },
              headRepositoryOwner: {
                login: "octocat",
              },
            }),
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.getPullRequest({
        cwd: "/repo",
        reference: "#42",
      });

      assert.deepStrictEqual(result, {
        number: 42,
        title: "Add PR thread creation",
        url: "https://github.com/pingdotgg/codething-mvp/pull/42",
        baseRefName: "main",
        headRefName: "feature/pr-threads",
        state: "open",
        isCrossRepository: true,
        headRepositoryNameWithOwner: "octocat/codething-mvp",
        headRepositoryOwnerLogin: "octocat",
      });
      expect(mockRun).toHaveBeenCalledWith({
        operation: "GitHubCli.execute",
        command: "gh",
        args: [
          "pr",
          "view",
          "#42",
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner",
        ],
        cwd: "/repo",
        timeoutMs: 30_000,
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("trims pull request fields decoded from gh json", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              number: 42,
              title: "  Add PR thread creation  \n",
              url: " https://github.com/pingdotgg/codething-mvp/pull/42 ",
              baseRefName: " main ",
              headRefName: "\tfeature/pr-threads\t",
              state: "OPEN",
              mergedAt: null,
              isCrossRepository: true,
              headRepository: {
                nameWithOwner: " octocat/codething-mvp ",
              },
              headRepositoryOwner: {
                login: " octocat ",
              },
            }),
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.getPullRequest({
        cwd: "/repo",
        reference: "#42",
      });

      assert.deepStrictEqual(result, {
        number: 42,
        title: "Add PR thread creation",
        url: "https://github.com/pingdotgg/codething-mvp/pull/42",
        baseRefName: "main",
        headRefName: "feature/pr-threads",
        state: "open",
        isCrossRepository: true,
        headRepositoryNameWithOwner: "octocat/codething-mvp",
        headRepositoryOwnerLogin: "octocat",
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("skips invalid entries when parsing pr lists", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify([
              {
                number: 0,
                title: "invalid",
                url: "https://github.com/pingdotgg/codething-mvp/pull/0",
                baseRefName: "main",
                headRefName: "feature/invalid",
              },
              {
                number: 43,
                title: "  Valid PR  ",
                url: " https://github.com/pingdotgg/codething-mvp/pull/43 ",
                baseRefName: " main ",
                headRefName: " feature/pr-list ",
                headRepository: {
                  nameWithOwner: "   ",
                },
                headRepositoryOwner: {
                  login: "   ",
                },
              },
            ]),
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.listOpenPullRequests({
        cwd: "/repo",
        headSelector: "feature/pr-list",
      });

      assert.deepStrictEqual(result, [
        {
          number: 43,
          title: "Valid PR",
          url: "https://github.com/pingdotgg/codething-mvp/pull/43",
          baseRefName: "main",
          headRefName: "feature/pr-list",
          state: "open",
        },
      ]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("reads repository clone URLs", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              nameWithOwner: "octocat/codething-mvp",
              url: "https://github.com/octocat/codething-mvp",
              sshUrl: "git@github.com:octocat/codething-mvp.git",
            }),
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.getRepositoryCloneUrls({
        cwd: "/repo",
        repository: "octocat/codething-mvp",
      });

      assert.deepStrictEqual(result, {
        nameWithOwner: "octocat/codething-mvp",
        url: "https://github.com/octocat/codething-mvp",
        sshUrl: "git@github.com:octocat/codething-mvp.git",
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("creates repositories and parses clone URLs from create output", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            "✓ Created repository octocat/codething-mvp on github.com\nhttps://github.com/octocat/codething-mvp\n",
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.createRepository({
        cwd: "/repo",
        repository: "octocat/codething-mvp",
        visibility: "private",
      });

      assert.deepStrictEqual(result, {
        nameWithOwner: "octocat/codething-mvp",
        url: "https://github.com/octocat/codething-mvp",
        sshUrl: "git@github.com:octocat/codething-mvp.git",
      });
      expect(mockRun).toHaveBeenCalledTimes(1);
      expect(mockRun).toHaveBeenNthCalledWith(1, {
        operation: "GitHubCli.execute",
        command: "gh",
        args: ["repo", "create", "octocat/codething-mvp", "--private"],
        cwd: "/repo",
        timeoutMs: 30_000,
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("falls back to constructed URLs when create output omits a URL", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput("")));

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.createRepository({
        cwd: "/repo",
        repository: "octocat/codething-mvp",
        visibility: "private",
      });

      assert.deepStrictEqual(result, {
        nameWithOwner: "octocat/codething-mvp",
        url: "https://github.com/octocat/codething-mvp",
        sshUrl: "git@github.com:octocat/codething-mvp.git",
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("surfaces a friendly error when the pull request is not found", () =>
    Effect.gen(function* () {
      const cause = new VcsProcessExitError({
        operation: "GitHubCli.execute",
        command: "gh pr view",
        cwd: "/repo",
        exitCode: 1,
        failureKind: "not-found",
        detail:
          "GraphQL: Could not resolve to a PullRequest with the number of 4888. (repository.pullRequest)",
      });
      mockRun.mockReturnValueOnce(Effect.fail(cause));

      const gh = yield* GitHubCli.GitHubCli;
      const error = yield* gh
        .getPullRequest({
          cwd: "/repo",
          reference: "4888",
        })
        .pipe(Effect.flip);

      assert.equal(error.message.includes("Pull request not found"), true);
      assert.strictEqual(error._tag, "GitHubPullRequestNotFoundError");
      assert.strictEqual(error.command, "gh");
      assert.strictEqual(error.cwd, "/repo");
      assert.strictEqual(error.cause, cause);
      assert.equal(error.message.includes(cause.detail), false);
    }).pipe(Effect.provide(layer)),
  );
});
