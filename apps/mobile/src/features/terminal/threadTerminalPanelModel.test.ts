import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildThreadTerminalAttachInput,
  threadTerminalSubscriptionKey,
  type ThreadTerminalSubscriptionIdentity,
} from "./threadTerminalPanelModel";

const identity: ThreadTerminalSubscriptionIdentity = {
  environmentId: EnvironmentId.make("env-1"),
  projectId: ProjectId.make("project-1"),
  terminalId: "default",
  cwd: "/repo",
  worktreePath: "/repo",
};

describe("threadTerminalSubscriptionKey", () => {
  it("does not include mutable terminal dimensions", () => {
    const initialAttach = buildThreadTerminalAttachInput(identity, { cols: 80, rows: 24 });
    const resizedAttach = buildThreadTerminalAttachInput(identity, { cols: 132, rows: 40 });

    expect(initialAttach).not.toEqual(resizedAttach);
    expect(threadTerminalSubscriptionKey(identity)).toBe(threadTerminalSubscriptionKey(identity));
  });

  it.each([
    ["environment", { environmentId: EnvironmentId.make("env-2") }],
    ["project", { projectId: ProjectId.make("project-2") }],
    ["terminal", { terminalId: "term-2" }],
    ["cwd", { cwd: "/repo/packages/app" }],
    ["worktree", { worktreePath: "/repo/worktrees/feature" }],
  ])("changes when the %s identity changes", (_label, update) => {
    expect(threadTerminalSubscriptionKey({ ...identity, ...update })).not.toBe(
      threadTerminalSubscriptionKey(identity),
    );
  });
});
