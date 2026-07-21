import { describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type GitHubPullRequestListItem,
} from "@t3tools/contracts";
import type { Thread } from "../types";
import {
  buildPullRequestActionItems,
  buildThreadActionItems,
  filterCommandPaletteGroups,
  type CommandPaletteGroup,
} from "./CommandPalette.logic";

const LOCAL_ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const PROJECT_ID = ProjectId.make("project-1");

const pullRequest: GitHubPullRequestListItem = {
  number: 42,
  title: "Improve search results",
  url: "https://github.com/octo/repo/pull/42",
  repository: "octo/repo",
  author: "octocat",
  state: "open",
  isDraft: false,
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-02T00:00:00.000Z",
  labels: [],
  ciStatus: "success",
  reviewStatus: "approved",
  hasConflicts: false,
};

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.make("thread-1"),
    environmentId: LOCAL_ENVIRONMENT_ID,
    projectId: PROJECT_ID,
    title: "Thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    createdAt: "2026-03-01T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    updatedAt: "2026-03-01T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    checkpoints: [],
    activities: [],
    ...overrides,
  };
}

describe("buildThreadActionItems", () => {
  it("orders threads by most recent activity and formats timestamps from updatedAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-25T12:00:00.000Z"));

    try {
      const items = buildThreadActionItems({
        threads: [
          makeThread({
            id: ThreadId.make("thread-older"),
            title: "Older thread",
            updatedAt: "2026-03-24T12:00:00.000Z",
          }),
          makeThread({
            id: ThreadId.make("thread-newer"),
            title: "Newer thread",
            createdAt: "2026-03-20T00:00:00.000Z",
            updatedAt: "2026-03-20T00:00:00.000Z",
          }),
        ],
        projectTitleById: new Map([[PROJECT_ID, "Project"]]),
        sortOrder: "updated_at",
        icon: null,
        runThread: async (_thread) => undefined,
      });

      expect(items.map((item) => item.value)).toEqual([
        "thread:thread-older",
        "thread:thread-newer",
      ]);
      expect(items[0]?.timestamp).toBe("1d ago");
      expect(items[1]?.timestamp).toBe("5d ago");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ranks thread title matches ahead of contextual project-name matches", () => {
    const threadItems = buildThreadActionItems({
      threads: [
        makeThread({
          id: ThreadId.make("thread-context-match"),
          title: "Fix navbar spacing",
          updatedAt: "2026-03-20T00:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("thread-title-match"),
          title: "Project kickoff notes",
          createdAt: "2026-03-02T00:00:00.000Z",
          updatedAt: "2026-03-19T00:00:00.000Z",
        }),
      ],
      projectTitleById: new Map([[PROJECT_ID, "Project"]]),
      sortOrder: "updated_at",
      icon: null,
      runThread: async (_thread) => undefined,
    });

    const groups = filterCommandPaletteGroups({
      activeGroups: [],
      query: "project",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: threadItems,
      pullRequestSearchItems: [],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.value).toBe("threads-search");
    expect(groups[0]?.items.map((item) => item.value)).toEqual([
      "thread:thread-title-match",
      "thread:thread-context-match",
    ]);
  });

  it("preserves thread project-name matches when there is no stronger title match", () => {
    const group: CommandPaletteGroup = {
      value: "threads-search",
      label: "Threads",
      items: [
        {
          kind: "action",
          value: "thread:project-context-only",
          searchTerms: ["Fix navbar spacing", "Project"],
          title: "Fix navbar spacing",
          description: "Project",
          icon: null,
          run: async () => undefined,
        },
      ],
    };

    const groups = filterCommandPaletteGroups({
      activeGroups: [group],
      query: "project",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: [],
      pullRequestSearchItems: [],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.value)).toEqual(["thread:project-context-only"]);
  });

  it("filters archived threads out of thread search items", () => {
    const items = buildThreadActionItems({
      threads: [
        makeThread({
          id: ThreadId.make("thread-active"),
          title: "Active thread",
          createdAt: "2026-03-02T00:00:00.000Z",
          updatedAt: "2026-03-19T00:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("thread-archived"),
          title: "Archived thread",
          archivedAt: "2026-03-20T00:00:00.000Z",
          updatedAt: "2026-03-20T00:00:00.000Z",
        }),
      ],
      projectTitleById: new Map([[PROJECT_ID, "Project"]]),
      sortOrder: "updated_at",
      icon: null,
      runThread: async (_thread) => undefined,
    });

    expect(items.map((item) => item.value)).toEqual(["thread:thread-active"]);
  });
});

describe("buildPullRequestActionItems", () => {
  it("builds title-searchable items and runs the selected pull request", async () => {
    const runPullRequest = vi.fn(async (_pullRequest: GitHubPullRequestListItem) => undefined);
    const items = buildPullRequestActionItems({
      items: [pullRequest],
      environmentId: LOCAL_ENVIRONMENT_ID,
      icon: null,
      runPullRequest,
    });

    expect(items[0]).toMatchObject({
      value: `pull-request:${LOCAL_ENVIRONMENT_ID}:octo/repo#42`,
      searchTerms: ["Improve search results"],
      title: "Improve search results",
      description: "octo/repo #42",
    });

    await items[0]?.run();
    expect(runPullRequest).toHaveBeenCalledWith(pullRequest);
  });

  it("does not expose malformed repository references", () => {
    const items = buildPullRequestActionItems({
      items: [{ ...pullRequest, repository: "repo-only" }],
      environmentId: LOCAL_ENVIRONMENT_ID,
      icon: null,
      runPullRequest: async () => undefined,
    });

    expect(items).toEqual([]);
  });
});

describe("pull request command palette filtering", () => {
  const items = buildPullRequestActionItems({
    items: [pullRequest],
    environmentId: LOCAL_ENVIRONMENT_ID,
    icon: null,
    runPullRequest: async () => undefined,
  });

  it("adds pull requests as a searchable root group", () => {
    const groups = filterCommandPaletteGroups({
      activeGroups: [],
      query: "improve",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: [],
      pullRequestSearchItems: items,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.value).toBe("pull-requests-search");
    expect(groups[0]?.label).toBe("Pull Requests");
  });

  it("does not match a pull request by repository alone", () => {
    const groups = filterCommandPaletteGroups({
      activeGroups: [],
      query: "octo/repo",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: [],
      pullRequestSearchItems: items,
    });

    expect(groups).toEqual([]);
  });
});
