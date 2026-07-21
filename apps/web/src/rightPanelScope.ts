import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  ProjectId,
  RightPanelSharingMode,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";

export type ThreadPanelScope = {
  readonly kind: "thread";
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
};

export type WorktreePanelScope = {
  readonly kind: "worktree";
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly worktreePath: string | null;
};

export type RightPanelScope = ThreadPanelScope | WorktreePanelScope;

export interface RightPanelScopeSource {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly worktreePath: string | null;
}

export function resolveRightPanelScope(
  source: RightPanelScopeSource,
  mode: RightPanelSharingMode,
): RightPanelScope {
  if (mode === "worktree") {
    return {
      kind: "worktree",
      environmentId: source.environmentId,
      projectId: source.projectId,
      worktreePath: source.worktreePath,
    };
  }
  return { kind: "thread", environmentId: source.environmentId, threadId: source.id };
}

export function rightPanelScopeKey(scope: RightPanelScope): string {
  if (scope.kind === "thread") {
    return `thread:${scopedThreadKey(scope)}`;
  }
  return `worktree:${scope.environmentId}\u0000${scope.projectId}\u0000${scope.worktreePath ?? ""}`;
}

export function previewScopeForRightPanel(scope: RightPanelScope) {
  return scope.kind === "thread"
    ? ({ _tag: "thread" as const, threadId: scope.threadId } as const)
    : ({
        _tag: "worktree" as const,
        projectId: scope.projectId,
        worktreePath: scope.worktreePath,
      } as const);
}

const previewScopeByThreadKey = new Map<string, ReturnType<typeof previewScopeForRightPanel>>();

/** Keeps legacy thread-shaped preview call sites aligned with the active panel scope. */
export function registerPreviewScopeForThread(ref: ScopedThreadRef, scope: RightPanelScope): void {
  previewScopeByThreadKey.set(scopedThreadKey(ref), previewScopeForRightPanel(scope));
}

export function previewScopeForThread(ref: ScopedThreadRef) {
  return (
    previewScopeByThreadKey.get(scopedThreadKey(ref)) ??
    ({ _tag: "thread" as const, threadId: ref.threadId } as const)
  );
}

export function previewScopeKeyForThread(ref: ScopedThreadRef): string {
  const scope = previewScopeForThread(ref);
  return scope._tag === "thread"
    ? `thread:${scopedThreadKey(ref)}`
    : `worktree:${ref.environmentId}\u0000${scope.projectId}\u0000${scope.worktreePath ?? ""}`;
}

export function threadPanelScope(ref: ScopedThreadRef): ThreadPanelScope {
  return { kind: "thread", environmentId: ref.environmentId, threadId: ref.threadId };
}
