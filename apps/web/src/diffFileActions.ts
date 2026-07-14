import type { ScopedThreadRef } from "@t3tools/contracts";

import { resolvePathLinkTarget } from "./terminal-links";
import { openWorkspaceFile } from "./workspaceFileActions";

interface OpenDiffFilePrimaryActionInput {
  readonly threadRef: ScopedThreadRef | null;
  readonly filePath: string;
  readonly activeCwd: string | undefined;
  readonly openInEditor: (targetPath: string) => void;
}

export function openDiffFilePrimaryAction({
  threadRef,
  filePath,
  activeCwd,
  openInEditor,
}: OpenDiffFilePrimaryActionInput): void {
  if (threadRef) {
    openWorkspaceFile({ threadRef, relativePath: filePath });
    return;
  }

  openInEditor(activeCwd ? resolvePathLinkTarget(filePath, activeCwd) : filePath);
}
