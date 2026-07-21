import type { EnvironmentId, ProjectId, TerminalAttachInput } from "@t3tools/contracts";

export interface ThreadTerminalSubscriptionIdentity {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly terminalId: TerminalAttachInput["terminalId"];
  readonly cwd: string;
  readonly worktreePath: string | null;
}

export interface TerminalGridSize {
  readonly cols: number;
  readonly rows: number;
}

export function threadTerminalSubscriptionKey(
  identity: ThreadTerminalSubscriptionIdentity,
): string {
  return JSON.stringify([
    identity.environmentId,
    identity.projectId,
    identity.worktreePath,
    identity.terminalId,
    identity.cwd,
  ]);
}

export function buildThreadTerminalAttachInput(
  identity: ThreadTerminalSubscriptionIdentity,
  gridSize: TerminalGridSize,
): TerminalAttachInput {
  return {
    projectId: identity.projectId,
    terminalId: identity.terminalId,
    cwd: identity.cwd,
    worktreePath: identity.worktreePath,
    cols: gridSize.cols,
    rows: gridSize.rows,
  };
}
