import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import type { SidebarProjectSnapshot } from "./sidebarProjectGrouping";
import {
  assignSidebarProjectToFolder,
  buildSidebarProjectFolderBuckets,
  resolveSidebarProjectFolderId,
  sanitizeSidebarProjectFolders,
} from "./sidebarProjectFolders";

const environmentId = EnvironmentId.make("environment-local");

function makeProjectSnapshot(input: {
  readonly key: string;
  readonly title: string;
  readonly physicalKeys?: readonly string[];
}): SidebarProjectSnapshot {
  const physicalKeys = input.physicalKeys ?? [`physical:${input.key}`];
  return {
    id: ProjectId.make(input.key),
    environmentId,
    title: input.title,
    displayName: input.title,
    workspaceRoot: `/work/${input.key}`,
    repositoryIdentity: null,
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    },
    createdAt: "2026-03-09T10:00:00.000Z",
    updatedAt: "2026-03-09T10:00:00.000Z",
    scripts: [],
    projectKey: input.key,
    groupedProjectCount: physicalKeys.length,
    environmentPresence: "local-only",
    allRemoteMembersAreDesktopLocal: false,
    memberProjectRefs: physicalKeys.map((physicalKey, index) => ({
      environmentId,
      projectId: ProjectId.make(`${input.key}-${index}`),
    })),
    remoteEnvironmentLabels: [],
    memberProjects: physicalKeys.map((physicalKey, index) => ({
      id: index === 0 ? ProjectId.make(input.key) : ProjectId.make(`${input.key}-${index}`),
      environmentId,
      title: `${input.title} ${index + 1}`,
      workspaceRoot: `/work/${physicalKey}`,
      repositoryIdentity: null,
      defaultModelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
      },
      createdAt: "2026-03-09T10:00:00.000Z",
      updatedAt: "2026-03-09T10:00:00.000Z",
      scripts: [],
      physicalProjectKey: physicalKey,
      environmentLabel: null,
    })),
  } satisfies SidebarProjectSnapshot;
}

const folders = [
  { id: "folder-work", name: "Work", color: "blue" },
  { id: "folder-personal", name: "Personal", color: "green" },
] as const;

describe("buildSidebarProjectFolderBuckets", () => {
  it("builds no buckets when there are no projects", () => {
    expect(
      buildSidebarProjectFolderBuckets({
        projects: [],
        folders,
        folderOrder: ["folder-work"],
        assignments: {},
      }),
    ).toEqual([]);
  });

  it("renders unfiled projects last and preserves incoming project order inside buckets", () => {
    const alpha = makeProjectSnapshot({ key: "alpha", title: "Alpha" });
    const beta = makeProjectSnapshot({ key: "beta", title: "Beta" });
    const gamma = makeProjectSnapshot({ key: "gamma", title: "Gamma" });

    const buckets = buildSidebarProjectFolderBuckets({
      projects: [alpha, beta, gamma],
      folders,
      folderOrder: ["folder-work"],
      assignments: {
        "physical:alpha": "folder-work",
        "physical:gamma": "folder-work",
      },
    });

    expect(buckets.map((bucket) => bucket.id)).toEqual(["folder-work", "__unfiled__"]);
    expect(buckets[0]?.projects.map((project) => project.projectKey)).toEqual(["alpha", "gamma"]);
    expect(buckets[1]?.projects.map((project) => project.projectKey)).toEqual(["beta"]);
  });

  it("orders folders by configured order and then by name for missing order entries", () => {
    const alpha = makeProjectSnapshot({ key: "alpha", title: "Alpha" });
    const beta = makeProjectSnapshot({ key: "beta", title: "Beta" });
    const gamma = makeProjectSnapshot({ key: "gamma", title: "Gamma" });

    const buckets = buildSidebarProjectFolderBuckets({
      projects: [alpha, beta, gamma],
      folders: [
        { id: "z", name: "Zulu", color: "red" },
        { id: "a", name: "Alpha folder", color: "blue" },
        { id: "m", name: "Manual first", color: "green" },
      ],
      folderOrder: ["m"],
      assignments: {
        "physical:alpha": "a",
        "physical:beta": "m",
        "physical:gamma": "z",
      },
    });

    expect(buckets.map((bucket) => bucket.id)).toEqual(["m", "a", "z"]);
  });

  it("ignores assignments to deleted folders", () => {
    const project = makeProjectSnapshot({ key: "alpha", title: "Alpha" });

    const buckets = buildSidebarProjectFolderBuckets({
      projects: [project],
      folders,
      folderOrder: ["folder-work"],
      assignments: {
        "physical:alpha": "missing-folder",
      },
    });

    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({ id: "__unfiled__", kind: "unfiled" });
  });
});

describe("assignSidebarProjectToFolder", () => {
  it("writes assignments for every grouped member physical key", () => {
    const project = makeProjectSnapshot({
      key: "alpha",
      title: "Alpha",
      physicalKeys: ["local:/repo", "remote:/repo"],
    });

    expect(
      assignSidebarProjectToFolder({
        assignments: {},
        project,
        folderId: "folder-work",
      }),
    ).toEqual({
      "local:/repo": "folder-work",
      "remote:/repo": "folder-work",
    });
  });

  it("removes assignments for every grouped member physical key", () => {
    const project = makeProjectSnapshot({
      key: "alpha",
      title: "Alpha",
      physicalKeys: ["local:/repo", "remote:/repo"],
    });

    expect(
      assignSidebarProjectToFolder({
        assignments: {
          "local:/repo": "folder-work",
          "remote:/repo": "folder-work",
          "other:/repo": "folder-work",
        },
        project,
        folderId: null,
      }),
    ).toEqual({
      "other:/repo": "folder-work",
    });
  });
});

describe("resolveSidebarProjectFolderId", () => {
  it("uses the representative member folder for mixed grouped assignments", () => {
    const project = makeProjectSnapshot({
      key: "alpha",
      title: "Alpha",
      physicalKeys: ["local:/repo", "remote:/repo"],
    });

    expect(
      resolveSidebarProjectFolderId(project, {
        "local:/repo": "folder-work",
        "remote:/repo": "folder-personal",
      }),
    ).toBe("folder-work");
  });
});

describe("sanitizeSidebarProjectFolders", () => {
  it("deduplicates folders, drops blank names, keeps valid colors, and cleans order", () => {
    expect(
      sanitizeSidebarProjectFolders({
        folders: [
          { id: "a", name: "Alpha", color: "blue" },
          { id: "a", name: "Duplicate", color: "green" },
          { id: "blank", name: " ", color: "green" },
          { id: "bad", name: "Bad", color: "not-a-color" as never },
          { id: "custom", name: "Custom", color: "#3b82f6" },
        ],
        folderOrder: ["missing", "custom", "a", "custom"],
        assignments: {
          "physical:a": "a",
          "physical:missing": "missing",
        },
      }),
    ).toEqual({
      folders: [
        { id: "a", name: "Alpha", color: "blue" },
        { id: "custom", name: "Custom", color: "#3b82f6" },
      ],
      folderOrder: ["custom", "a"],
      assignments: {
        "physical:a": "a",
      },
    });
  });
});
