import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";

import { useComposerDraftStore } from "./composerDraftStore";
import { useRecentProjectFilesStore } from "./recentProjectFilesStore";
import { useRightPanelStore } from "./rightPanelStore";
import { readThreadShell } from "./state/entities";

function projectRefForThread(ref: ScopedThreadRef) {
  const thread = readThreadShell(ref);
  if (thread) {
    return scopeProjectRef(thread.environmentId, thread.projectId);
  }

  const draft = useComposerDraftStore.getState().getDraftSessionByRef(ref);
  return draft ? scopeProjectRef(draft.environmentId, draft.projectId) : null;
}

/** Opens a workspace file and records it for the project's file palette. */
export function openWorkspaceFile(input: {
  readonly threadRef: ScopedThreadRef;
  readonly relativePath: string;
  readonly line?: number | undefined;
}): void {
  useRightPanelStore.getState().openFile(input.threadRef, input.relativePath, input.line);
  const projectRef = projectRefForThread(input.threadRef);
  if (projectRef) {
    useRecentProjectFilesStore.getState().record(projectRef, input.relativePath);
  }
}
