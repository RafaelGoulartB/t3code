import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ScopedProjectRef, ThreadId } from "@t3tools/contracts";
import {
  ChevronDownIcon,
  CloudIcon,
  FolderGit2Icon,
  FolderGitIcon,
  FolderIcon,
  MonitorIcon,
} from "lucide-react";
import { memo, useMemo } from "react";

import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { useProject, useThread } from "../state/entities";
import { useIsMobile } from "../hooks/useMediaQuery";
import {
  type EnvMode,
  type EnvironmentOption,
  resolveCurrentWorkspaceLabel,
  resolveEnvModeLabel,
  resolveEffectiveEnvMode,
  resolveLockedWorkspaceLabel,
} from "./BranchToolbar.logic";
import { BranchToolbarBranchSelector } from "./BranchToolbarBranchSelector";
import { BranchToolbarEnvironmentSelector } from "./BranchToolbarEnvironmentSelector";
import { BranchToolbarEnvModeSelector } from "./BranchToolbarEnvModeSelector";
import { BranchToolbarProjectSelector } from "./BranchToolbarProjectSelector";
import { Button } from "./ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "./ui/menu";
import { Separator } from "./ui/separator";

interface BranchToolbarProps {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  draftId?: DraftId;
  onEnvModeChange: (mode: EnvMode) => void;
  effectiveEnvModeOverride?: EnvMode;
  activeThreadBranchOverride?: string | null;
  onActiveThreadBranchOverrideChange?: (branch: string | null) => void;
  startFromOrigin: boolean;
  onStartFromOriginChange: (startFromOrigin: boolean) => void;
  envLocked: boolean;
  isGitRepo: boolean;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest?: () => void;
  availableEnvironments?: readonly EnvironmentOption[];
  onEnvironmentChange?: (environmentId: EnvironmentId) => void;
  availableProjects: ReadonlyArray<EnvironmentProject>;
  projectLocked: boolean;
  onProjectChange: (projectRef: ScopedProjectRef) => void;
}

interface MobileRunContextSelectorProps {
  envLocked: boolean;
  envModeLocked: boolean;
  environmentId: EnvironmentId;
  availableEnvironments: readonly EnvironmentOption[] | undefined;
  showEnvironmentPicker: boolean;
  onEnvironmentChange: ((environmentId: EnvironmentId) => void) | undefined;
  effectiveEnvMode: EnvMode;
  activeWorktreePath: string | null;
  onEnvModeChange: (mode: EnvMode) => void;
  activeProject: EnvironmentProject | null;
  availableProjects: ReadonlyArray<EnvironmentProject>;
  projectLocked: boolean;
  onProjectChange: (projectRef: ScopedProjectRef) => void;
}

const MobileRunContextSelector = memo(function MobileRunContextSelector({
  envLocked,
  envModeLocked,
  environmentId,
  availableEnvironments,
  showEnvironmentPicker,
  onEnvironmentChange,
  effectiveEnvMode,
  activeWorktreePath,
  onEnvModeChange,
  activeProject,
  availableProjects,
  projectLocked,
  onProjectChange,
}: MobileRunContextSelectorProps) {
  const activeEnvironment = useMemo(
    () => availableEnvironments?.find((env) => env.environmentId === environmentId) ?? null,
    [availableEnvironments, environmentId],
  );
  const WorkspaceIcon =
    effectiveEnvMode === "worktree"
      ? FolderGit2Icon
      : activeWorktreePath
        ? FolderGitIcon
        : FolderIcon;
  const workspaceLabel = envModeLocked
    ? resolveLockedWorkspaceLabel(activeWorktreePath)
    : effectiveEnvMode === "worktree"
      ? resolveEnvModeLabel("worktree")
      : resolveCurrentWorkspaceLabel(activeWorktreePath);
  const isLocked = envLocked || envModeLocked;
  const EnvironmentIcon = activeEnvironment?.isPrimary ? MonitorIcon : CloudIcon;
  const showProjectGroup = availableProjects.length > 0;
  const icon = showEnvironmentPicker ? (
    // Button's base styles apply `-mx-0.5` to descendant SVGs, which eats 4px
    // out of whatever gap we set. mx-0! cancels that so gap-0.5 reads as 2px.
    <span className="inline-flex shrink-0 items-center gap-0.5">
      <EnvironmentIcon className="size-3 shrink-0 mx-0!" />
      <WorkspaceIcon className="size-3 shrink-0 mx-0!" />
    </span>
  ) : (
    <WorkspaceIcon className="size-3 shrink-0" />
  );
  const triggerContent = (
    <>
      {icon}
      <span className="min-w-0 truncate">
        {showEnvironmentPicker ? (activeEnvironment?.label ?? "Run on") : workspaceLabel}
      </span>
    </>
  );

  if (isLocked) {
    return (
      <span className="inline-flex min-w-0 max-w-[48%] flex-1 items-center justify-start gap-1 rounded-md border border-transparent px-[calc(--spacing(2)-1px)] text-sm font-medium text-muted-foreground/70 md:hidden">
        {triggerContent}
      </span>
    );
  }

  return (
    <Menu>
      <MenuTrigger
        render={<Button variant="ghost" size="xs" />}
        className="min-w-0 max-w-[48%] flex-1 justify-start text-muted-foreground/70 hover:text-foreground/80 md:hidden"
      >
        {triggerContent}
        <ChevronDownIcon className="size-3 shrink-0 opacity-50" />
      </MenuTrigger>
      <MenuPopup align="start" side="top" className="w-64">
        {showProjectGroup ? (
          <>
            <MenuGroup>
              <MenuGroupLabel>Project</MenuGroupLabel>
              <MenuRadioGroup
                value={activeProject?.id ?? null}
                onValueChange={(value) => {
                  const next = availableProjects.find((project) => project.id === value);
                  if (!next) return;
                  onProjectChange({ environmentId: next.environmentId, projectId: next.id });
                }}
              >
                {availableProjects.map((project) => (
                  <MenuRadioItem key={project.id} disabled={projectLocked} value={project.id}>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <FolderIcon className="size-3" />
                      <span className="min-w-0 truncate">{project.title}</span>
                    </span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
            <MenuSeparator />
          </>
        ) : null}
        {showEnvironmentPicker && availableEnvironments && onEnvironmentChange ? (
          <>
            <MenuGroup>
              <MenuGroupLabel>Run on</MenuGroupLabel>
              <MenuRadioGroup
                value={environmentId}
                onValueChange={(value) => onEnvironmentChange(value as EnvironmentId)}
              >
                {availableEnvironments.map((env) => {
                  const Icon = env.isPrimary ? MonitorIcon : CloudIcon;
                  return (
                    <MenuRadioItem
                      key={env.environmentId}
                      disabled={envLocked}
                      value={env.environmentId}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Icon className="size-3" />
                        <span className="min-w-0 truncate">{env.label}</span>
                      </span>
                    </MenuRadioItem>
                  );
                })}
              </MenuRadioGroup>
            </MenuGroup>
            <MenuSeparator />
          </>
        ) : null}
        <MenuGroup>
          <MenuGroupLabel>Workspace</MenuGroupLabel>
          <MenuRadioGroup
            value={effectiveEnvMode}
            onValueChange={(value) => onEnvModeChange(value as EnvMode)}
          >
            <MenuRadioItem disabled={envModeLocked} value="local">
              <span className="flex min-w-0 items-center gap-1.5">
                {activeWorktreePath ? (
                  <FolderGitIcon className="size-3" />
                ) : (
                  <FolderIcon className="size-3" />
                )}
                <span className="min-w-0 truncate">
                  {resolveCurrentWorkspaceLabel(activeWorktreePath)}
                </span>
              </span>
            </MenuRadioItem>
            <MenuRadioItem disabled={envModeLocked} value="worktree">
              <span className="flex min-w-0 items-center gap-1.5">
                <FolderGit2Icon className="size-3" />
                <span className="min-w-0 truncate">{resolveEnvModeLabel("worktree")}</span>
              </span>
            </MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
});

export const BranchToolbar = memo(function BranchToolbar({
  environmentId,
  threadId,
  draftId,
  onEnvModeChange,
  effectiveEnvModeOverride,
  activeThreadBranchOverride,
  onActiveThreadBranchOverrideChange,
  startFromOrigin,
  onStartFromOriginChange,
  envLocked,
  isGitRepo,
  onCheckoutPullRequestRequest,
  onComposerFocusRequest,
  availableEnvironments,
  onEnvironmentChange,
  availableProjects,
  projectLocked,
  onProjectChange,
}: BranchToolbarProps) {
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const serverThread = useThread(threadRef);
  const draftThread = useComposerDraftStore((store) =>
    draftId ? store.getDraftSession(draftId) : store.getDraftThreadByRef(threadRef),
  );
  const activeProjectRef = serverThread
    ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
    : draftThread
      ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
      : null;
  const activeProject = useProject(activeProjectRef);
  const hasActiveThread = serverThread !== null || draftThread !== null;
  const activeWorktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const effectiveEnvMode =
    effectiveEnvModeOverride ??
    resolveEffectiveEnvMode({
      activeWorktreePath,
      hasServerThread: serverThread !== null,
      draftThreadEnvMode: draftThread?.envMode,
    });
  const envModeLocked = envLocked || (serverThread !== null && activeWorktreePath !== null);

  const showEnvironmentPicker = Boolean(
    availableEnvironments && availableEnvironments.length > 1 && onEnvironmentChange,
  );
  const isMobile = useIsMobile();

  if (!hasActiveThread || !activeProject) return null;

  return (
    <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-2.5 pb-3 pt-1 sm:px-3">
      {isMobile ? (
        <MobileRunContextSelector
          envLocked={envLocked}
          envModeLocked={envModeLocked}
          environmentId={environmentId}
          availableEnvironments={availableEnvironments}
          showEnvironmentPicker={showEnvironmentPicker}
          onEnvironmentChange={onEnvironmentChange}
          effectiveEnvMode={effectiveEnvMode}
          activeWorktreePath={activeWorktreePath}
          onEnvModeChange={onEnvModeChange}
          activeProject={activeProject}
          availableProjects={availableProjects}
          projectLocked={projectLocked}
          onProjectChange={onProjectChange}
        />
      ) : (
        <div className="flex min-w-0 shrink-0 items-center gap-1">
          <BranchToolbarProjectSelector
            projectLocked={projectLocked}
            activeProject={activeProject}
            availableProjects={availableProjects}
            onProjectChange={onProjectChange}
          />
          {isGitRepo && showEnvironmentPicker && availableEnvironments && onEnvironmentChange && (
            <>
              <Separator orientation="vertical" className="mx-0.5 h-3.5!" />
              <BranchToolbarEnvironmentSelector
                envLocked={envLocked}
                environmentId={environmentId}
                availableEnvironments={availableEnvironments}
                onEnvironmentChange={onEnvironmentChange}
              />
            </>
          )}
          {isGitRepo && (
            <>
              <Separator orientation="vertical" className="mx-0.5 h-3.5!" />
              <BranchToolbarEnvModeSelector
                envLocked={envModeLocked}
                effectiveEnvMode={effectiveEnvMode}
                activeWorktreePath={activeWorktreePath}
                onEnvModeChange={onEnvModeChange}
              />
            </>
          )}
        </div>
      )}

      {isGitRepo && (
        <BranchToolbarBranchSelector
          className="min-w-0 flex-1 justify-end md:ml-auto md:flex-none"
          environmentId={environmentId}
          threadId={threadId}
          {...(draftId ? { draftId } : {})}
          envLocked={envLocked}
          {...(effectiveEnvModeOverride ? { effectiveEnvModeOverride } : {})}
          {...(activeThreadBranchOverride !== undefined ? { activeThreadBranchOverride } : {})}
          {...(onActiveThreadBranchOverrideChange ? { onActiveThreadBranchOverrideChange } : {})}
          startFromOrigin={startFromOrigin}
          onStartFromOriginChange={onStartFromOriginChange}
          {...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {})}
          {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
        />
      )}
    </div>
  );
});
