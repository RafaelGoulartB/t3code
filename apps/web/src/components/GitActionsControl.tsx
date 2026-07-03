import { useAtomValue } from "@effect/atom-react";
import { type ScopedThreadRef } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  GitActionProgressEvent,
  GitRunStackedActionResult,
  GitStackedAction,
  SourceControlCloneProtocol,
  SourceControlProviderDiscoveryItem,
  SourceControlProviderKind,
  SourceControlPublishRepositoryResult,
  SourceControlRepositoryVisibility,
  VcsStatusResult,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Option from "effect/Option";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  CheckIcon,
  ChevronDownIcon,
  CloudUploadIcon,
  DownloadIcon,
  ExternalLinkIcon,
  GitBranchPlusIcon,
  GitBranchIcon,
  GitCommitIcon,
  InfoIcon,
  LockIcon,
  GlobeIcon,
  ArchiveIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { AzureDevOpsIcon, BitbucketIcon, GitHubIcon, GitLabIcon } from "~/components/Icons";
import { RadioGroup } from "~/components/ui/radio-group";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";
import {
  buildGitActionProgressStages,
  buildMenuItems,
  type GitActionIconName,
  type GitActionMenuItem,
  type GitQuickAction,
  type DefaultBranchConfirmableAction,
  requiresDefaultBranchConfirmation,
  pruneExcludedGitFilePaths,
  resolveDefaultBranchActionDialogCopy,
  resolveGitFileSelection,
  resolveLiveThreadBranchUpdate,
  resolveQuickAction,
  resolveThreadBranchUpdate,
  shouldOpenCommitSelectionForQuickAction,
} from "./GitActionsControl.logic";
import { AnimatedHeight } from "./AnimatedHeight";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Group, GroupSeparator } from "~/components/ui/group";
import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Textarea } from "~/components/ui/textarea";
import { stackedThreadToast, toastManager, type ThreadToastData } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useOpenInPreferredEditor } from "~/editorPreferences";
import {
  useGitStackedAction,
  useSourceControlActionRunning,
  useSourceControlPublishRepositoryAction,
  useVcsDiscardChangesAction,
  useVcsFetchAction,
  useVcsInitAction,
  useVcsPullAction,
  useVcsStashApplyAction,
  useVcsStashDropAction,
  useVcsStashPushAction,
} from "~/lib/sourceControlActions";
import { useThread } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { sourceControlEnvironment } from "~/state/sourceControl";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";
import { randomUUID } from "~/lib/utils";
import { resolvePathLinkTarget } from "~/terminal-links";
import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { readLocalApi } from "~/localApi";
import { getSourceControlPresentation } from "~/sourceControlPresentation";
import { openPullRequestLink } from "~/lib/openPullRequestLink";

interface GitActionsControlProps {
  gitCwd: string | null;
  activeThreadRef: ScopedThreadRef | null;
  draftId?: DraftId;
}

interface PendingDefaultBranchAction {
  action: DefaultBranchConfirmableAction;
  branchName: string;
  includesCommit: boolean;
  commitMessage?: string;
  onConfirmed?: () => void;
  filePaths?: ReadonlyArray<string>;
}

type PublishProviderKind = Extract<
  SourceControlProviderKind,
  "github" | "gitlab" | "bitbucket" | "azure-devops"
>;

type GitActionToastId = ReturnType<typeof toastManager.add>;

interface ActiveGitActionProgress {
  toastId: GitActionToastId;
  toastData: ThreadToastData | undefined;
  actionId: string;
  title: string;
  phaseStartedAtMs: number | null;
  hookStartedAtMs: number | null;
  hookName: string | null;
  lastOutputLine: string | null;
  currentPhaseLabel: string | null;
}

interface RunGitActionWithToastInput {
  action: GitStackedAction;
  commitMessage?: string;
  onConfirmed?: () => void;
  skipDefaultBranchPrompt?: boolean;
  statusOverride?: VcsStatusResult | null;
  featureBranch?: boolean;
  progressToastId?: GitActionToastId;
  filePaths?: ReadonlyArray<string>;
}

const GIT_STATUS_WINDOW_REFRESH_DEBOUNCE_MS = 250;

type RefreshVcsStatus = (target: {
  readonly environmentId: ScopedThreadRef["environmentId"];
  readonly input: { readonly cwd: string };
}) => Promise<unknown>;

function requestVcsStatusRefresh(
  refresh: RefreshVcsStatus,
  environmentId: ScopedThreadRef["environmentId"] | null,
  cwd: string | null,
): void {
  if (environmentId === null || cwd === null) {
    return;
  }
  void refresh({ environmentId, input: { cwd } });
}
const RUNNING_SOURCE_CONTROL_ACTIONS = [
  "runStackedAction",
  "pull",
  "fetch",
  "publishRepository",
] as const;

const PUBLISH_PROVIDER_OPTIONS = [
  {
    value: "github",
    label: "GitHub",
    description: "github.com",
    host: "github.com",
    pathPlaceholder: "owner/repo",
    Icon: GitHubIcon,
  },
  {
    value: "gitlab",
    label: "GitLab",
    description: "gitlab.com",
    host: "gitlab.com",
    pathPlaceholder: "group/project",
    Icon: GitLabIcon,
  },
  {
    value: "bitbucket",
    label: "Bitbucket",
    description: "bitbucket.org",
    host: "bitbucket.org",
    pathPlaceholder: "workspace/repository",
    Icon: BitbucketIcon,
  },
  {
    value: "azure-devops",
    label: "Azure DevOps",
    description: "dev.azure.com",
    host: "dev.azure.com",
    pathPlaceholder: "project/repository",
    Icon: AzureDevOpsIcon,
  },
] as const satisfies ReadonlyArray<{
  readonly value: PublishProviderKind;
  readonly label: string;
  readonly description: string;
  readonly host: string;
  readonly pathPlaceholder: string;
  readonly Icon: typeof GitHubIcon;
}>;

function publishProviderOption(provider: PublishProviderKind) {
  return (
    PUBLISH_PROVIDER_OPTIONS.find((option) => option.value === provider) ??
    PUBLISH_PROVIDER_OPTIONS[0]
  );
}

function isPublishProviderKind(
  provider: SourceControlProviderKind,
): provider is PublishProviderKind {
  return PUBLISH_PROVIDER_OPTIONS.some((option) => option.value === provider);
}

function getPublishProviderReadiness(input: {
  provider: PublishProviderKind;
  sourceControlProviders: ReadonlyArray<SourceControlProviderDiscoveryItem>;
}): { readonly ready: boolean; readonly hint: string | null } {
  const discovered = input.sourceControlProviders.find(
    (provider) => provider.kind === input.provider,
  );
  if (!discovered) {
    return {
      ready: false,
      hint: "Provider status unavailable. Open Settings -> Source Control and rescan.",
    };
  }
  if (discovered.status !== "available") {
    return { ready: false, hint: discovered.installHint };
  }
  if (discovered.auth.status === "unauthenticated") {
    return {
      ready: false,
      hint:
        Option.getOrNull(discovered.auth.detail) ??
        `${discovered.label} is not authenticated. Open Settings -> Source Control for setup guidance.`,
    };
  }
  return { ready: true, hint: null };
}

function formatElapsedDescription(startedAtMs: number | null): string | undefined {
  if (startedAtMs === null) {
    return undefined;
  }
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
  if (elapsedSeconds < 60) {
    return `Running for ${elapsedSeconds}s`;
  }
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `Running for ${minutes}m ${seconds}s`;
}

function resolveProgressDescription(progress: ActiveGitActionProgress): string | undefined {
  if (progress.lastOutputLine) {
    return progress.lastOutputLine;
  }
  return formatElapsedDescription(progress.hookStartedAtMs ?? progress.phaseStartedAtMs);
}

function getMenuActionDisabledReason({
  item,
  gitStatus,
  isBusy,
  hasPrimaryRemote,
}: {
  item: GitActionMenuItem;
  gitStatus: VcsStatusResult | null;
  isBusy: boolean;
  hasPrimaryRemote: boolean;
}): string | null {
  if (!item.disabled) return null;
  if (isBusy) return "Git action in progress.";
  if (!gitStatus) return "Git status is unavailable.";

  const hasBranch = gitStatus.refName !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isAhead = gitStatus.aheadCount > 0;
  const isBehind = gitStatus.behindCount > 0;
  const isDiverged = isAhead && isBehind;
  const terminology = getSourceControlPresentation(gitStatus.sourceControlProvider).terminology;

  if (item.id === "commit") {
    if (!hasChanges) {
      return "Worktree is clean. Make changes before committing.";
    }
    return "Commit is currently unavailable.";
  }

  if (item.id === "pull") {
    if (!hasBranch) {
      return "Detached HEAD: checkout a ref before pulling.";
    }
    if (!gitStatus.hasUpstream) {
      return "Current ref has no upstream configured.";
    }
    if (isDiverged) {
      return "Branch has diverged from upstream. Rebase/merge first.";
    }
    if (!isBehind) {
      return "Branch is already up to date.";
    }
    return "Pull is currently unavailable.";
  }

  if (item.id === "fetch") {
    if (!hasPrimaryRemote) {
      return 'Add an "origin" remote before fetching.';
    }
    return "Fetch is currently unavailable.";
  }

  if (item.id === "push") {
    if (!hasBranch) {
      return "Detached HEAD: checkout a refName before pushing.";
    }
    if (hasChanges) {
      return "Commit or stash local changes before pushing.";
    }
    if (isBehind) {
      return "Branch is behind upstream. Pull/rebase before pushing.";
    }
    if (!gitStatus.hasUpstream && !hasPrimaryRemote) {
      return 'Add an "origin" remote before pushing.';
    }
    if (!isAhead) {
      return "No local commits to push.";
    }
    return "Push is currently unavailable.";
  }

  if (hasOpenPr) {
    return `View ${terminology.singular} is currently unavailable.`;
  }
  if (!hasBranch) {
    return `Detached HEAD: checkout a refName before creating a ${terminology.singular}.`;
  }
  if (hasChanges) {
    return `Commit local changes before creating a ${terminology.singular}.`;
  }
  if (!gitStatus.hasUpstream && !hasPrimaryRemote) {
    return `Add an "origin" remote before creating a ${terminology.singular}.`;
  }
  if (!isAhead) {
    return `No local commits to include in a ${terminology.singular}.`;
  }
  if (isBehind) {
    return `Branch is behind upstream. Pull/rebase before creating a ${terminology.singular}.`;
  }
  return `Create ${terminology.singular} is currently unavailable.`;
}

const COMMIT_DIALOG_TITLE = "Commit changes";
const COMMIT_DIALOG_DESCRIPTION =
  "Review and confirm your commit. Leave the message blank to auto-generate one.";

function GitActionItemIcon({
  icon,
  SourceControlIcon,
}: {
  icon: GitActionIconName;
  SourceControlIcon: ReturnType<typeof getSourceControlPresentation>["Icon"];
}) {
  if (icon === "commit") return <GitCommitIcon />;
  if (icon === "pull") return <DownloadIcon />;
  if (icon === "fetch") return <RefreshCwIcon />;
  if (icon === "push") return <CloudUploadIcon />;
  return <SourceControlIcon />;
}

function GitQuickActionIcon({
  quickAction,
  SourceControlIcon,
}: {
  quickAction: GitQuickAction;
  SourceControlIcon: ReturnType<typeof getSourceControlPresentation>["Icon"];
}) {
  const iconClassName = "size-3.5";
  if (quickAction.kind === "open_pr") return <SourceControlIcon className={iconClassName} />;
  if (quickAction.kind === "open_publish") return <CloudUploadIcon className={iconClassName} />;
  if (quickAction.kind === "run_pull") return <DownloadIcon className={iconClassName} />;
  if (quickAction.kind === "run_action") {
    if (quickAction.action === "commit") return <GitCommitIcon className={iconClassName} />;
    if (quickAction.action === "push" || quickAction.action === "commit_push") {
      return <CloudUploadIcon className={iconClassName} />;
    }
    return <SourceControlIcon className={iconClassName} />;
  }
  if (quickAction.label === "Commit") return <GitCommitIcon className={iconClassName} />;
  return <InfoIcon className={iconClassName} />;
}

interface PublishRepositoryDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: ScopedThreadRef["environmentId"] | null;
  readonly gitCwd: string;
}

function PublishRepositoryDialog(props: PublishRepositoryDialogProps) {
  const navigate = useNavigate();
  const sourceControlDiscovery = useEnvironmentQuery(
    props.environmentId === null
      ? null
      : sourceControlEnvironment.discovery({
          environmentId: props.environmentId,
          input: {},
        }),
  );
  const [selectedPublishProvider, setSelectedPublishProvider] =
    useState<PublishProviderKind | null>(null);
  const [publishRepositoryOverride, setPublishRepositoryOverride] = useState<string | null>(null);
  const [publishVisibility, setPublishVisibility] =
    useState<SourceControlRepositoryVisibility>("private");
  const [publishRemoteName, setPublishRemoteName] = useState("origin");
  const [publishProtocol, setPublishProtocol] = useState<SourceControlCloneProtocol>("ssh");
  const [publishWizardStep, setPublishWizardStep] = useState(0);
  const [publishAdvancedOpen, setPublishAdvancedOpen] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishResult, setPublishResult] = useState<SourceControlPublishRepositoryResult | null>(
    null,
  );
  const sourceControlScope = useMemo(
    () => ({
      environmentId: props.environmentId,
      cwd: props.gitCwd,
    }),
    [props.environmentId, props.gitCwd],
  );
  const publishRepositoryAction = useSourceControlPublishRepositoryAction(sourceControlScope);
  const publishAccountByProvider = useMemo(() => {
    const accounts: Record<PublishProviderKind, string | null> = {
      github: null,
      gitlab: null,
      bitbucket: null,
      "azure-devops": null,
    };
    for (const provider of sourceControlDiscovery.data?.sourceControlProviders ?? []) {
      if (isPublishProviderKind(provider.kind)) {
        accounts[provider.kind] = Option.getOrNull(provider.auth.account);
      }
    }
    return accounts;
  }, [sourceControlDiscovery.data]);
  const publishProviderReadiness = useMemo(() => {
    const sourceControlProviders = sourceControlDiscovery.data?.sourceControlProviders ?? [];
    return Object.fromEntries(
      PUBLISH_PROVIDER_OPTIONS.map((option) => [
        option.value,
        getPublishProviderReadiness({
          provider: option.value,
          sourceControlProviders,
        }),
      ]),
    ) as Record<PublishProviderKind, { readonly ready: boolean; readonly hint: string | null }>;
  }, [sourceControlDiscovery.data]);
  const hasReadyPublishProvider = useMemo(
    () => PUBLISH_PROVIDER_OPTIONS.some((option) => publishProviderReadiness[option.value].ready),
    [publishProviderReadiness],
  );
  const sortedPublishProviderOptions = useMemo(
    () =>
      PUBLISH_PROVIDER_OPTIONS.toSorted((left, right) => {
        const leftReady = publishProviderReadiness[left.value].ready;
        const rightReady = publishProviderReadiness[right.value].ready;
        if (leftReady !== rightReady) {
          return leftReady ? -1 : 1;
        }
        return left.label.localeCompare(right.label);
      }),
    [publishProviderReadiness],
  );
  const firstReadyPublishProvider = sortedPublishProviderOptions.find(
    (option) => publishProviderReadiness[option.value].ready,
  )?.value;
  const publishProvider =
    selectedPublishProvider !== null && publishProviderReadiness[selectedPublishProvider].ready
      ? selectedPublishProvider
      : (firstReadyPublishProvider ?? selectedPublishProvider ?? "github");
  const selectedPublishProviderReadiness = publishProviderReadiness[publishProvider];
  const publishRepositoryPrefill = publishAccountByProvider[publishProvider]
    ? `${publishAccountByProvider[publishProvider]}/`
    : "";
  const publishRepository = publishRepositoryOverride ?? publishRepositoryPrefill;
  const currentPublishProvider = publishProviderOption(publishProvider);
  const publishHost = currentPublishProvider.host;
  const publishPathPlaceholder = currentPublishProvider.pathPlaceholder;
  const publishProviderLabel = currentPublishProvider.label;
  const publishWizardSteps = ["Provider", "Repository", "Summary"] as const;
  const publishWizardStepSummaries = [
    publishProviderLabel,
    publishResult?.repository.nameWithOwner ?? null,
    null,
  ] as const;

  const canSubmitPublishRepository = useMemo(() => {
    if (!selectedPublishProviderReadiness.ready) return false;
    if (publishRepositoryAction.isPending) return false;
    const repositoryParts = publishRepository.trim().split("/");
    const owner = repositoryParts[0]?.trim() ?? "";
    const rest = repositoryParts.slice(1);
    const name = rest.join("/").trim();
    return owner.length > 0 && name.length > 0;
  }, [publishRepository, publishRepositoryAction.isPending, selectedPublishProviderReadiness]);

  const submitPublishRepository = useCallback(() => {
    if (!canSubmitPublishRepository) {
      return;
    }

    setPublishError(null);

    void (async () => {
      const result = await publishRepositoryAction.run({
        provider: publishProvider,
        repository: publishRepository.trim(),
        visibility: publishVisibility,
        remoteName: publishRemoteName.trim() || "origin",
        protocol: publishProtocol,
      });

      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          setPublishError(error instanceof Error ? error.message : "An error occurred.");
        }
        return;
      }

      flushSync(() => {
        setPublishResult(result.value);
        setPublishWizardStep(2);
      });
    })();
  }, [
    canSubmitPublishRepository,
    props.environmentId,
    props.gitCwd,
    publishProtocol,
    publishProvider,
    publishRemoteName,
    publishRepository,
    publishRepositoryAction,
    publishVisibility,
  ]);

  const resetState = useCallback(() => {
    setPublishRemoteName("origin");
    setPublishRepositoryOverride(null);
    setPublishWizardStep(0);
    setPublishAdvancedOpen(false);
    setPublishError(null);
    setPublishResult(null);
  }, []);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      props.onOpenChange(open);
      if (!open) {
        resetState();
      }
    },
    [props, resetState],
  );

  const openSourceControlSettings = useCallback(() => {
    handleOpenChange(false);
    void navigate({ to: "/settings/source-control" });
  }, [handleOpenChange, navigate]);

  return (
    <Dialog open={props.open} onOpenChange={handleOpenChange}>
      <DialogPopup className="max-w-xl overflow-hidden">
        <div className="flex min-h-0 flex-col overflow-hidden border-foreground/10 bg-background shadow-2xl">
          <DialogHeader className="border-b border-border/70 bg-background">
            <DialogTitle>Publish repository</DialogTitle>
            <DialogDescription>
              Pick where to host it, then point us at a repo to push to.
            </DialogDescription>
            <div className="grid grid-cols-3 gap-2">
              {publishWizardSteps.map((label, index) => {
                const isComplete = index < publishWizardStep;
                const isClickable =
                  publishWizardStep !== 2 &&
                  index < publishWizardSteps.length - 1 &&
                  index <= publishWizardStep;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={isClickable ? () => setPublishWizardStep(index) : undefined}
                    disabled={!isClickable}
                    className={cn(
                      "grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] gap-x-2 rounded-lg border px-3 py-2 text-left",
                      index === publishWizardStep
                        ? "border-primary bg-primary/10 ring-1 ring-primary/25"
                        : isComplete
                          ? "border-border bg-background"
                          : "border-border bg-muted/40",
                      !isClickable && "cursor-default",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "row-span-2 mt-0.5 grid size-4 place-items-center rounded-full border",
                        isComplete
                          ? "border-primary bg-primary text-primary-foreground"
                          : index === publishWizardStep
                            ? "border-primary bg-background"
                            : "border-muted-foreground/35 bg-background",
                      )}
                    >
                      {isComplete ? <CheckIcon className="size-3" /> : null}
                    </span>
                    <span className="text-[10px] font-medium uppercase text-muted-foreground">
                      Step {index + 1}
                    </span>
                    <span className="truncate text-xs font-semibold text-foreground">
                      {label}
                      {isComplete && publishWizardStepSummaries[index]
                        ? `: ${publishWizardStepSummaries[index]}`
                        : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </DialogHeader>

          <DialogPanel className="space-y-5 border-b border-border/70 bg-muted/20 px-6 py-5">
            <AnimatedHeight>
              <div className={cn("space-y-2", publishWizardStep !== 0 && "hidden")}>
                <span
                  id="publish-provider-cards-label"
                  className="text-xs font-medium text-foreground"
                >
                  Provider
                </span>
                <RadioGroup
                  value={publishProvider}
                  onValueChange={(value) => {
                    setSelectedPublishProvider(value as PublishProviderKind);
                    setPublishRepositoryOverride(null);
                  }}
                  aria-labelledby="publish-provider-cards-label"
                  className="grid grid-cols-2 gap-2.5"
                >
                  {sortedPublishProviderOptions.map((option) => {
                    const readiness = publishProviderReadiness[option.value];
                    const isSelected = publishProvider === option.value && readiness.ready;
                    if (!readiness.ready) {
                      return (
                        <div
                          key={option.value}
                          className="relative flex cursor-not-allowed items-center gap-3 rounded-lg border border-border bg-background px-3 py-3 text-left opacity-55"
                        >
                          <option.Icon
                            className="size-5 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                            {option.label}
                          </span>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  variant="outline"
                                  size="xs"
                                  className="h-5 rounded-[.25rem] px-1.5 text-[10px] text-warning-foreground"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    openSourceControlSettings();
                                  }}
                                >
                                  Setup Required
                                </Button>
                              }
                            />
                            <TooltipPopup side="top" align="end" className="max-w-72">
                              {readiness.hint ??
                                "Open Settings -> Source Control to configure this provider."}
                            </TooltipPopup>
                          </Tooltip>
                        </div>
                      );
                    }

                    return (
                      <RadioPrimitive.Root
                        key={option.value}
                        value={option.value}
                        className={cn(
                          "relative flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-3 text-left outline-none transition-[background-color,border-color,box-shadow]",
                          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                          isSelected
                            ? "border-primary bg-background shadow-sm ring-2 ring-primary/35"
                            : "border-border bg-background hover:border-foreground/20 hover:bg-muted/50",
                        )}
                      >
                        <option.Icon className="size-5 shrink-0" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                          {option.label}
                        </span>
                      </RadioPrimitive.Root>
                    );
                  })}
                </RadioGroup>
              </div>

              <div className={cn("space-y-5", publishWizardStep !== 1 && "hidden")}>
                <div className="space-y-2">
                  <label
                    htmlFor="publish-repository-path"
                    className="text-xs font-medium text-foreground"
                  >
                    Repository
                  </label>
                  <div className="flex items-stretch overflow-hidden rounded-md border border-input bg-background focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-ring">
                    <span className="flex shrink-0 items-center gap-1.5 border-r border-input bg-muted/50 px-2.5 font-mono text-xs text-muted-foreground">
                      <currentPublishProvider.Icon className="size-3.5" />
                      {publishHost}/
                    </span>
                    <input
                      id="publish-repository-path"
                      name="publish-repository-path"
                      value={publishRepository}
                      onChange={(event) => {
                        setPublishRepositoryOverride(event.target.value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          submitPublishRepository();
                        }
                      }}
                      placeholder={publishPathPlaceholder}
                      disabled={publishRepositoryAction.isPending}
                      className="w-full bg-transparent px-3 py-2 font-mono text-sm placeholder:text-muted-foreground/60 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <span
                    id="publish-visibility-cards-label"
                    className="text-xs font-medium text-foreground"
                  >
                    Visibility
                  </span>
                  <RadioGroup
                    value={publishVisibility}
                    onValueChange={(value) =>
                      setPublishVisibility(value as SourceControlRepositoryVisibility)
                    }
                    aria-labelledby="publish-visibility-cards-label"
                    disabled={publishRepositoryAction.isPending}
                    className="grid grid-cols-2 gap-2.5"
                  >
                    {[
                      {
                        value: "private" as const,
                        label: "Private",
                        description: "Only invited people",
                        Icon: LockIcon,
                      },
                      {
                        value: "public" as const,
                        label: "Public",
                        description: "Anyone on the web",
                        Icon: GlobeIcon,
                      },
                    ].map((option) => {
                      const isSelected = publishVisibility === option.value;
                      return (
                        <RadioPrimitive.Root
                          key={option.value}
                          value={option.value}
                          className={cn(
                            "relative flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-left outline-none transition-[background-color,border-color,box-shadow]",
                            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                            isSelected
                              ? "border-primary bg-background shadow-sm ring-2 ring-primary/35"
                              : "border-border bg-background hover:border-foreground/20 hover:bg-muted/50",
                          )}
                        >
                          <option.Icon
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-foreground">
                              {option.label}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {option.description}
                            </span>
                          </span>
                        </RadioPrimitive.Root>
                      );
                    })}
                  </RadioGroup>
                </div>

                <div>
                  <button
                    type="button"
                    onClick={() => setPublishAdvancedOpen((prev) => !prev)}
                    aria-expanded={publishAdvancedOpen}
                    className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ChevronDownIcon
                      className={cn(
                        "size-3.5 transition-transform",
                        publishAdvancedOpen ? "" : "-rotate-90",
                      )}
                    />
                    Advanced
                  </button>
                  {publishAdvancedOpen ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1.5" htmlFor="publish-remote-name">
                        <span className="text-xs font-medium text-foreground">Remote</span>
                        <Input
                          id="publish-remote-name"
                          value={publishRemoteName}
                          onChange={(event) => setPublishRemoteName(event.target.value)}
                          placeholder="origin"
                          disabled={publishRepositoryAction.isPending}
                        />
                      </label>
                      <div className="space-y-1.5">
                        <span
                          id="publish-protocol-label"
                          className="text-xs font-medium text-foreground"
                        >
                          Protocol
                        </span>
                        <RadioGroup
                          value={publishProtocol}
                          onValueChange={(value) =>
                            setPublishProtocol(value as SourceControlCloneProtocol)
                          }
                          aria-labelledby="publish-protocol-label"
                          disabled={publishRepositoryAction.isPending}
                          className="grid grid-cols-2 gap-2"
                        >
                          {(["ssh", "https"] as const).map((value) => {
                            const isSelected = publishProtocol === value;
                            return (
                              <RadioPrimitive.Root
                                key={value}
                                value={value}
                                className={cn(
                                  "rounded-md border px-3 py-1.5 text-center text-sm font-medium outline-none transition",
                                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                                  isSelected
                                    ? "border-primary bg-background ring-2 ring-primary/35 text-foreground"
                                    : "border-border bg-background text-muted-foreground hover:border-foreground/20 hover:text-foreground",
                                )}
                              >
                                {value === "ssh" ? "SSH" : "HTTPS"}
                              </RadioPrimitive.Root>
                            );
                          })}
                        </RadioGroup>
                      </div>
                    </div>
                  ) : null}
                </div>

                {publishRepositoryAction.isPending ? (
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex items-center gap-2 rounded-md border border-input bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
                  >
                    <Spinner className="size-3.5" aria-hidden />
                    Publishing repository to {publishProviderLabel}...
                  </div>
                ) : null}
                {publishError && !publishRepositoryAction.isPending ? (
                  <div
                    role="alert"
                    className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                  >
                    <p className="font-medium">Publish failed</p>
                    <p className="mt-0.5 text-destructive/90">{publishError}</p>
                  </div>
                ) : null}
              </div>

              <div className={cn("space-y-4", publishWizardStep !== 2 && "hidden")}>
                {publishResult ? (
                  <>
                    <div className="flex flex-col items-center gap-2 py-1 text-center">
                      <span className="grid size-8 place-items-center rounded-full bg-success/15 text-success">
                        <CheckIcon className="size-4" aria-hidden />
                      </span>
                      <h3 className="text-sm font-semibold text-foreground">
                        {publishResult.status === "pushed"
                          ? "Repository published"
                          : "Repository created"}
                      </h3>
                      <p className="max-w-xs text-pretty text-xs text-muted-foreground">
                        {publishResult.status === "pushed"
                          ? `${publishResult.branch} is now live on ${publishProviderLabel}.`
                          : `Remote "${publishResult.remoteName}" is set up. Make a commit and push it to share your code.`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg border border-input bg-muted/40 px-3 py-2">
                      <currentPublishProvider.Icon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                        {publishResult.repository.nameWithOwner}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        const api = readLocalApi();
                        if (!api) return;
                        void api.shell.openExternal(publishResult.repository.url);
                      }}
                    >
                      <ExternalLinkIcon className="size-3.5" aria-hidden />
                      Open on {publishProviderLabel}
                    </Button>
                  </>
                ) : (
                  <div className="rounded-md border border-input bg-background px-3 py-2 text-xs text-muted-foreground">
                    Publish result unavailable.
                  </div>
                )}
              </div>
            </AnimatedHeight>
          </DialogPanel>

          <DialogFooter>
            {publishWizardStep === 2 ? (
              <Button size="sm" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={publishRepositoryAction.isPending}
                  onClick={() => {
                    if (publishWizardStep === 0) {
                      handleOpenChange(false);
                      return;
                    }
                    setPublishWizardStep((step) => Math.max(0, step - 1));
                  }}
                >
                  {publishWizardStep === 0 ? "Cancel" : "Back"}
                </Button>
                {publishWizardStep < 1 ? (
                  <Button
                    size="sm"
                    disabled={!hasReadyPublishProvider || !selectedPublishProviderReadiness.ready}
                    onClick={() => setPublishWizardStep((step) => Math.min(1, step + 1))}
                  >
                    Next
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={!canSubmitPublishRepository}
                    onClick={submitPublishRepository}
                  >
                    {publishRepositoryAction.isPending ? (
                      <>
                        <Spinner className="size-3.5" aria-hidden />
                        Publishing...
                      </>
                    ) : (
                      "Publish"
                    )}
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

export default function GitActionsControl({
  gitCwd,
  activeThreadRef,
  draftId,
}: GitActionsControlProps) {
  const updateThreadMetadata = useAtomCommand(
    threadEnvironment.updateMetadata,
    "thread branch metadata update",
  );
  const activeEnvironmentId = activeThreadRef?.environmentId ?? null;
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(activeEnvironmentId));
  const openInPreferredEditor = useOpenInPreferredEditor(
    activeEnvironmentId,
    serverConfig?.availableEditors ?? [],
  );
  const threadToastData = useMemo(
    () => (activeThreadRef ? { threadRef: activeThreadRef } : undefined),
    [activeThreadRef],
  );
  const activeServerThread = useThread(activeThreadRef);
  const activeDraftThread = useComposerDraftStore((store) =>
    draftId
      ? store.getDraftSession(draftId)
      : activeThreadRef
        ? store.getDraftThreadByRef(activeThreadRef)
        : null,
  );
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const [isCommitDialogOpen, setIsCommitDialogOpen] = useState(false);
  const [commitDialogAction, setCommitDialogAction] = useState<GitStackedAction>("commit");
  const [dialogCommitMessage, setDialogCommitMessage] = useState("");
  const [excludedFiles, setExcludedFiles] = useState<ReadonlySet<string>>(new Set());
  const [isEditingFiles, setIsEditingFiles] = useState(false);
  const [selectionTouched, setSelectionTouched] = useState(false);
  const [stashMessage, setStashMessage] = useState("");
  const [isGitMenuOpen, setIsGitMenuOpen] = useState(false);
  const [isBranchDialogOpen, setIsBranchDialogOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [newWorktreeBase, setNewWorktreeBase] = useState("");
  const [newWorktreeBranch, setNewWorktreeBranch] = useState("");
  const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false);
  const [pendingDefaultBranchAction, setPendingDefaultBranchAction] =
    useState<PendingDefaultBranchAction | null>(null);
  const activeGitActionProgressRef = useRef<ActiveGitActionProgress | null>(null);
  const sourceControlScope = useMemo(
    () => ({ environmentId: activeEnvironmentId, cwd: gitCwd }),
    [activeEnvironmentId, gitCwd],
  );
  let runGitActionWithToast: (input: RunGitActionWithToastInput) => Promise<void>;

  const updateActiveProgressToast = useCallback(() => {
    const progress = activeGitActionProgressRef.current;
    if (!progress) {
      return;
    }
    toastManager.update(progress.toastId, {
      type: "loading",
      title: progress.title,
      description: resolveProgressDescription(progress),
      timeout: 0,
      data: progress.toastData,
    });
  }, []);

  const persistThreadBranchSync = useCallback(
    (branch: string | null) => {
      if (!activeThreadRef) {
        return;
      }

      if (activeServerThread) {
        if (activeServerThread.branch === branch) {
          return;
        }

        const worktreePath = activeServerThread.worktreePath;
        void updateThreadMetadata({
          environmentId: activeThreadRef.environmentId,
          input: {
            threadId: activeThreadRef.threadId,
            branch,
            worktreePath,
          },
        });

        return;
      }

      if (!activeDraftThread || activeDraftThread.branch === branch) {
        return;
      }

      setDraftThreadContext(draftId ?? activeThreadRef, {
        branch,
        worktreePath: activeDraftThread.worktreePath,
      });
    },
    [
      activeDraftThread,
      activeServerThread,
      activeThreadRef,
      draftId,
      setDraftThreadContext,
      updateThreadMetadata,
    ],
  );

  const syncThreadBranchAfterGitAction = useCallback(
    (result: GitRunStackedActionResult) => {
      const branchUpdate = resolveThreadBranchUpdate(result);
      if (!branchUpdate) {
        return;
      }

      persistThreadBranchSync(branchUpdate.branch);
    },
    [persistThreadBranchSync],
  );

  const gitStatusQuery = useEnvironmentQuery(
    activeEnvironmentId !== null && gitCwd !== null
      ? vcsEnvironment.status({
          environmentId: activeEnvironmentId,
          input: { cwd: gitCwd },
        })
      : null,
  );
  const refreshVcsStatus = useAtomCommand(vcsEnvironment.refreshStatus, {
    reportFailure: false,
  });
  const { data: gitStatus, error: gitStatusError } = gitStatusQuery;
  const sourceControlPresentation = useMemo(
    () => getSourceControlPresentation(gitStatus?.sourceControlProvider),
    [gitStatus?.sourceControlProvider],
  );
  const changeRequestTerminology = sourceControlPresentation.terminology;
  const SourceControlIcon = sourceControlPresentation.Icon;
  // Default to true while loading so we don't flash init controls.
  const isRepo = gitStatus?.isRepo ?? true;
  const hasPrimaryRemote = gitStatus?.hasPrimaryRemote ?? false;
  const gitStatusForActions = gitStatus;

  const allFiles = gitStatusForActions?.workingTree.files ?? [];
  const allFilePaths = useMemo(() => allFiles.map((file) => file.path), [allFiles]);
  const fileSelection = useMemo(
    () =>
      resolveGitFileSelection({
        allPaths: allFilePaths,
        excludedPaths: excludedFiles,
        selectionTouched,
      }),
    [allFilePaths, excludedFiles, selectionTouched],
  );
  const selectedFilePaths = fileSelection.selectedFilePathsForCommit;
  const selectedFiles = useMemo(() => {
    const selectedPaths = new Set(fileSelection.selectedPaths);
    return allFiles.filter((file) => selectedPaths.has(file.path));
  }, [allFiles, fileSelection.selectedPaths]);
  const allSelected = fileSelection.allSelected;
  const noneSelected = fileSelection.noneSelected;
  const explicitSelectionEmpty = fileSelection.explicitSelectionEmpty;

  const branchRefsQuery = useEnvironmentQuery(
    activeEnvironmentId !== null && gitCwd !== null && isBranchDialogOpen
      ? vcsEnvironment.listRefs({
          environmentId: activeEnvironmentId,
          input: { cwd: gitCwd, refKind: "local", limit: 200 },
        })
      : null,
  );
  const stashListQuery = useEnvironmentQuery(
    activeEnvironmentId !== null && gitCwd !== null && (isGitMenuOpen || isBranchDialogOpen)
      ? vcsEnvironment.stashList({
          environmentId: activeEnvironmentId,
          input: { cwd: gitCwd },
        })
      : null,
  );

  const initAction = useVcsInitAction(sourceControlScope);
  const runImmediateGitAction = useGitStackedAction(sourceControlScope);
  const pullAction = useVcsPullAction(sourceControlScope);
  const fetchAction = useVcsFetchAction(sourceControlScope);
  const discardChangesAction = useVcsDiscardChangesAction(sourceControlScope);
  const stashPushAction = useVcsStashPushAction(sourceControlScope);
  const stashApplyAction = useVcsStashApplyAction(sourceControlScope);
  const stashDropAction = useVcsStashDropAction(sourceControlScope);
  const createRefCommand = useAtomCommand(vcsEnvironment.createRef, { reportFailure: false });
  const switchRefCommand = useAtomCommand(vcsEnvironment.switchRef, { reportFailure: false });
  const deleteBranchCommand = useAtomCommand(vcsEnvironment.deleteBranch, { reportFailure: false });
  const createWorktreeCommand = useAtomCommand(vcsEnvironment.createWorktree, {
    reportFailure: false,
  });
  const removeWorktreeCommand = useAtomCommand(vcsEnvironment.removeWorktree, {
    reportFailure: false,
  });
  const isGitActionRunning = useSourceControlActionRunning(sourceControlScope, [
    ...RUNNING_SOURCE_CONTROL_ACTIONS,
    "discardChanges",
    "stashPush",
    "stashApply",
    "stashDrop",
  ]);
  const isSelectingWorktreeBase =
    !activeServerThread &&
    activeDraftThread?.envMode === "worktree" &&
    activeDraftThread.worktreePath === null;

  useEffect(() => {
    setExcludedFiles((current) =>
      pruneExcludedGitFilePaths({ excludedPaths: current, allPaths: allFilePaths }),
    );
  }, [allFilePaths]);

  useEffect(() => {
    if (isGitActionRunning || isSelectingWorktreeBase) {
      return;
    }

    const branchUpdate = resolveLiveThreadBranchUpdate({
      threadBranch: activeServerThread?.branch ?? activeDraftThread?.branch ?? null,
      gitStatus: gitStatusForActions,
    });
    if (!branchUpdate) {
      return;
    }

    persistThreadBranchSync(branchUpdate.branch);
  }, [
    activeServerThread?.branch,
    activeDraftThread?.branch,
    gitStatusForActions,
    isGitActionRunning,
    isSelectingWorktreeBase,
    persistThreadBranchSync,
  ]);

  const isDefaultRef = useMemo(() => {
    return gitStatusForActions?.isDefaultRef ?? false;
  }, [gitStatusForActions?.isDefaultRef]);

  const gitActionMenuItems = useMemo(
    () => buildMenuItems(gitStatusForActions, isGitActionRunning, hasPrimaryRemote),
    [gitStatusForActions, hasPrimaryRemote, isGitActionRunning],
  );
  const quickAction = useMemo(
    () =>
      resolveQuickAction(gitStatusForActions, isGitActionRunning, isDefaultRef, hasPrimaryRemote),
    [gitStatusForActions, hasPrimaryRemote, isDefaultRef, isGitActionRunning],
  );
  const quickActionDisabledReason = quickAction.disabled
    ? (quickAction.hint ?? "This action is currently unavailable.")
    : null;
  const pendingDefaultBranchActionCopy = pendingDefaultBranchAction
    ? resolveDefaultBranchActionDialogCopy({
        action: pendingDefaultBranchAction.action,
        branchName: pendingDefaultBranchAction.branchName,
        includesCommit: pendingDefaultBranchAction.includesCommit,
        terminology: changeRequestTerminology,
      })
    : null;

  const resetCommitDialogState = useCallback(() => {
    setIsCommitDialogOpen(false);
    setCommitDialogAction("commit");
    setDialogCommitMessage("");
    setExcludedFiles(new Set());
    setSelectionTouched(false);
    setIsEditingFiles(false);
    setStashMessage("");
  }, []);

  const openCommitDialogForAction = useCallback((action: GitStackedAction) => {
    setCommitDialogAction(action);
    setExcludedFiles(new Set());
    setSelectionTouched(false);
    setIsEditingFiles(false);
    setIsCommitDialogOpen(true);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!activeGitActionProgressRef.current) {
        return;
      }
      updateActiveProgressToast();
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [updateActiveProgressToast]);

  useEffect(() => {
    if (gitCwd === null) {
      return;
    }

    let refreshTimeout: number | null = null;
    const scheduleRefreshCurrentGitStatus = () => {
      if (refreshTimeout !== null) {
        window.clearTimeout(refreshTimeout);
      }
      refreshTimeout = window.setTimeout(() => {
        refreshTimeout = null;
        requestVcsStatusRefresh(refreshVcsStatus, activeEnvironmentId, gitCwd);
      }, GIT_STATUS_WINDOW_REFRESH_DEBOUNCE_MS);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        scheduleRefreshCurrentGitStatus();
      }
    };

    window.addEventListener("focus", scheduleRefreshCurrentGitStatus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (refreshTimeout !== null) {
        window.clearTimeout(refreshTimeout);
      }
      window.removeEventListener("focus", scheduleRefreshCurrentGitStatus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeEnvironmentId, gitCwd, refreshVcsStatus]);

  const openExistingPr = useCallback(async () => {
    const api = readLocalApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Link opening is unavailable.",
        data: threadToastData,
      });
      return;
    }
    const prUrl = gitStatusForActions?.pr?.state === "open" ? gitStatusForActions.pr.url : null;
    if (!prUrl) {
      toastManager.add({
        type: "error",
        title: "No open pull request found.",
        data: threadToastData,
      });
      return;
    }
    void openPullRequestLink(api.shell, prUrl).catch((err: unknown) => {
      console.error(err);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to open pull request link",
          description: err instanceof Error ? err.message : "An error occurred.",
          ...(threadToastData !== undefined ? { data: threadToastData } : {}),
        }),
      );
    });
  }, [gitStatusForActions, threadToastData]);

  runGitActionWithToast = useEffectEvent(
    async ({
      action,
      commitMessage,
      onConfirmed,
      skipDefaultBranchPrompt = false,
      statusOverride,
      featureBranch = false,
      progressToastId,
      filePaths,
    }: RunGitActionWithToastInput) => {
      const actionStatus = statusOverride ?? gitStatusForActions;
      const actionBranch = actionStatus?.refName ?? null;
      const actionIsDefaultBranch = featureBranch ? false : isDefaultRef;
      const actionCanCommit =
        action === "commit" || action === "commit_push" || action === "commit_push_pr";
      const includesCommit =
        actionCanCommit &&
        (action === "commit" || !!actionStatus?.hasWorkingTreeChanges || featureBranch);
      if (
        !skipDefaultBranchPrompt &&
        requiresDefaultBranchConfirmation(action, actionIsDefaultBranch) &&
        actionBranch
      ) {
        if (
          action !== "push" &&
          action !== "create_pr" &&
          action !== "commit_push" &&
          action !== "commit_push_pr"
        ) {
          return;
        }
        setPendingDefaultBranchAction({
          action,
          branchName: actionBranch,
          includesCommit,
          ...(commitMessage ? { commitMessage } : {}),
          ...(onConfirmed ? { onConfirmed } : {}),
          ...(filePaths ? { filePaths } : {}),
        });
        return;
      }
      onConfirmed?.();

      const progressStages = buildGitActionProgressStages({
        action,
        hasCustomCommitMessage: !!commitMessage?.trim(),
        hasWorkingTreeChanges: !!actionStatus?.hasWorkingTreeChanges,
        featureBranch,
        terminology: changeRequestTerminology,
        shouldPushBeforePr:
          action === "create_pr" &&
          (!actionStatus?.hasUpstream || (actionStatus?.aheadCount ?? 0) > 0),
      });
      const scopedToastData = threadToastData ? { ...threadToastData } : undefined;
      const actionId = randomUUID();
      const resolvedProgressToastId =
        progressToastId ??
        toastManager.add({
          type: "loading",
          title: progressStages[0] ?? "Running git action...",
          description: "Waiting for Git...",
          timeout: 0,
          data: scopedToastData,
        });

      activeGitActionProgressRef.current = {
        toastId: resolvedProgressToastId,
        toastData: scopedToastData,
        actionId,
        title: progressStages[0] ?? "Running git action...",
        phaseStartedAtMs: null,
        hookStartedAtMs: null,
        hookName: null,
        lastOutputLine: null,
        currentPhaseLabel: progressStages[0] ?? "Running git action...",
      };

      if (progressToastId) {
        toastManager.update(progressToastId, {
          type: "loading",
          title: progressStages[0] ?? "Running git action...",
          description: "Waiting for Git...",
          timeout: 0,
          data: scopedToastData,
        });
      }

      const applyProgressEvent = (event: GitActionProgressEvent) => {
        const progress = activeGitActionProgressRef.current;
        if (!progress) {
          return;
        }
        if (gitCwd && event.cwd !== gitCwd) {
          return;
        }
        if (progress.actionId !== event.actionId) {
          return;
        }

        const now = Date.now();
        switch (event.kind) {
          case "action_started":
            progress.phaseStartedAtMs = now;
            progress.hookStartedAtMs = null;
            progress.hookName = null;
            progress.lastOutputLine = null;
            break;
          case "phase_started":
            progress.title = event.label;
            progress.currentPhaseLabel = event.label;
            progress.phaseStartedAtMs = now;
            progress.hookStartedAtMs = null;
            progress.hookName = null;
            progress.lastOutputLine = null;
            break;
          case "hook_started":
            progress.title = `Running ${event.hookName}...`;
            progress.hookName = event.hookName;
            progress.hookStartedAtMs = now;
            progress.lastOutputLine = null;
            break;
          case "hook_output":
            progress.lastOutputLine = event.text;
            break;
          case "hook_finished":
            progress.title = progress.currentPhaseLabel ?? "Committing...";
            progress.hookName = null;
            progress.hookStartedAtMs = null;
            progress.lastOutputLine = null;
            break;
          case "action_finished":
            // Let the resolved mutation update the toast so we keep the
            // elapsed description visible until the final success state renders.
            return;
          case "action_failed":
            // Let the settled mutation publish the error toast to avoid a
            // transient intermediate state before the final failure message.
            return;
        }

        updateActiveProgressToast();
      };

      const result = await runImmediateGitAction.run({
        actionId,
        action,
        ...(commitMessage ? { commitMessage } : {}),
        ...(featureBranch ? { featureBranch } : {}),
        ...(filePaths ? { filePaths: [...filePaths] } : {}),
        onProgress: applyProgressEvent,
      });

      activeGitActionProgressRef.current = null;
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) {
          toastManager.close(resolvedProgressToastId);
          return;
        }

        const error = squashAtomCommandFailure(result);
        toastManager.update(
          resolvedProgressToastId,
          stackedThreadToast({
            type: "error",
            title: "Action failed",
            description: error instanceof Error ? error.message : "An error occurred.",
            ...(scopedToastData !== undefined ? { data: scopedToastData } : {}),
          }),
        );
        return;
      }

      const actionResult = result.value;
      syncThreadBranchAfterGitAction(actionResult);
      const closeResultToast = () => {
        toastManager.close(resolvedProgressToastId);
      };

      const toastCta = actionResult.toast.cta;
      let toastActionProps: {
        children: string;
        onClick: () => void;
      } | null = null;
      if (toastCta.kind === "run_action") {
        toastActionProps = {
          children: toastCta.label,
          onClick: () => {
            closeResultToast();
            void runGitActionWithToast({
              action: toastCta.action.kind,
            });
          },
        };
      } else if (toastCta.kind === "open_pr") {
        toastActionProps = {
          children: toastCta.label,
          onClick: () => {
            const api = readLocalApi();
            if (!api) return;
            closeResultToast();
            void api.shell.openExternal(toastCta.url);
          },
        };
      }

      const successToastData = {
        ...scopedToastData,
        dismissAfterVisibleMs: 10_000,
      };

      if (toastActionProps) {
        toastManager.update(
          resolvedProgressToastId,
          stackedThreadToast({
            type: "success",
            title: actionResult.toast.title,
            description: actionResult.toast.description,
            timeout: 0,
            actionProps: toastActionProps,
            data: successToastData,
          }),
        );
      } else {
        toastManager.update(resolvedProgressToastId, {
          type: "success",
          title: actionResult.toast.title,
          description: actionResult.toast.description,
          timeout: 0,
          data: successToastData,
        });
      }
    },
  );

  const continuePendingDefaultBranchAction = () => {
    if (!pendingDefaultBranchAction) return;
    const { action, commitMessage, onConfirmed, filePaths } = pendingDefaultBranchAction;
    setPendingDefaultBranchAction(null);
    void runGitActionWithToast({
      action,
      ...(commitMessage ? { commitMessage } : {}),
      ...(onConfirmed ? { onConfirmed } : {}),
      ...(filePaths ? { filePaths } : {}),
      skipDefaultBranchPrompt: true,
    });
  };

  const checkoutFeatureBranchAndContinuePendingAction = () => {
    if (!pendingDefaultBranchAction) return;
    const { action, commitMessage, onConfirmed, filePaths } = pendingDefaultBranchAction;
    setPendingDefaultBranchAction(null);
    void runGitActionWithToast({
      action,
      ...(commitMessage ? { commitMessage } : {}),
      ...(onConfirmed ? { onConfirmed } : {}),
      ...(filePaths ? { filePaths } : {}),
      featureBranch: true,
      skipDefaultBranchPrompt: true,
    });
  };

  const runDialogActionOnNewBranch = () => {
    if (!isCommitDialogOpen) return;
    const commitMessage = dialogCommitMessage.trim();

    resetCommitDialogState();

    void runGitActionWithToast({
      action: commitDialogAction,
      ...(commitMessage ? { commitMessage } : {}),
      ...(selectedFilePaths ? { filePaths: selectedFilePaths } : {}),
      featureBranch: true,
      skipDefaultBranchPrompt: true,
    });
  };

  const runPullActionWithToast = () => {
    const toastId = toastManager.add({
      type: "loading",
      title: "Pulling...",
      timeout: 0,
      data: threadToastData,
    });
    void (async () => {
      const result = await pullAction.run();
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) {
          toastManager.close(toastId);
          return;
        }
        const error = squashAtomCommandFailure(result);
        toastManager.update(
          toastId,
          stackedThreadToast({
            type: "error",
            title: "Pull failed",
            description: error instanceof Error ? error.message : "An error occurred.",
            ...(threadToastData !== undefined ? { data: threadToastData } : {}),
          }),
        );
        return;
      }

      const pullResult = result.value;
      toastManager.update(toastId, {
        type: "success",
        title: pullResult.status === "pulled" ? "Pulled" : "Already up to date",
        description:
          pullResult.status === "pulled"
            ? `Updated ${pullResult.refName} from ${pullResult.upstreamRef ?? "upstream"}`
            : `${pullResult.refName} is already synchronized.`,
        data: threadToastData,
      });
    })();
  };

  const runFetchActionWithToast = () => {
    const toastId = toastManager.add({
      type: "loading",
      title: "Fetching...",
      timeout: 0,
      data: threadToastData,
    });
    void (async () => {
      const result = await fetchAction.run();
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) {
          toastManager.close(toastId);
          return;
        }
        const error = squashAtomCommandFailure(result);
        toastManager.update(
          toastId,
          stackedThreadToast({
            type: "error",
            title: "Fetch failed",
            description: error instanceof Error ? error.message : "An error occurred.",
            ...(threadToastData !== undefined ? { data: threadToastData } : {}),
          }),
        );
        return;
      }

      toastManager.update(toastId, {
        type: "success",
        title: "Fetched",
        description: `Updated remote refs from ${result.value.remoteName}.`,
        data: threadToastData,
      });
    })();
  };

  const runQuickAction = () => {
    if (quickAction.kind === "open_pr") {
      void openExistingPr();
      return;
    }
    if (quickAction.kind === "open_publish") {
      setIsPublishDialogOpen(true);
      return;
    }
    if (quickAction.kind === "run_pull") {
      runPullActionWithToast();
      return;
    }
    if (quickAction.kind === "show_hint") {
      toastManager.add({
        type: "info",
        title: quickAction.label,
        description: quickAction.hint,
        data: threadToastData,
      });
      return;
    }
    if (quickAction.action) {
      if (
        shouldOpenCommitSelectionForQuickAction({ quickAction, gitStatus: gitStatusForActions })
      ) {
        openCommitDialogForAction(quickAction.action);
        return;
      }
      void runGitActionWithToast({ action: quickAction.action });
    }
  };

  const openDialogForMenuItem = (item: GitActionMenuItem) => {
    if (item.disabled) return;
    if (item.kind === "open_pr") {
      void openExistingPr();
      return;
    }
    if (item.kind === "run_pull") {
      runPullActionWithToast();
      return;
    }
    if (item.kind === "run_fetch") {
      runFetchActionWithToast();
      return;
    }
    if (item.dialogAction === "push") {
      void runGitActionWithToast({ action: "push" });
      return;
    }
    if (item.dialogAction === "create_pr") {
      void runGitActionWithToast({ action: "create_pr" });
      return;
    }
    openCommitDialogForAction("commit");
  };

  const runDialogAction = () => {
    if (!isCommitDialogOpen) return;
    const commitMessage = dialogCommitMessage.trim();
    resetCommitDialogState();
    void runGitActionWithToast({
      action: commitDialogAction,
      ...(commitMessage ? { commitMessage } : {}),
      ...(selectedFilePaths ? { filePaths: selectedFilePaths } : {}),
    });
  };

  const openChangedFileInEditor = useCallback(
    (filePath: string) => {
      if (!gitCwd) {
        toastManager.add({
          type: "error",
          title: "Editor opening is unavailable.",
          data: threadToastData,
        });
        return;
      }
      const target = resolvePathLinkTarget(filePath, gitCwd);
      void (async () => {
        const result = await openInPreferredEditor(target);
        if (result._tag === "Success" || isAtomCommandInterrupted(result)) {
          return;
        }
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to open file",
            description: error instanceof Error ? error.message : "An error occurred.",
            ...(threadToastData !== undefined ? { data: threadToastData } : {}),
          }),
        );
      })();
    },
    [gitCwd, openInPreferredEditor, threadToastData],
  );

  const selectedOrAllFilePaths = fileSelection.selectedOrAllPaths;

  const runDiscardSelectedChanges = () => {
    if (selectedOrAllFilePaths.length === 0) return;
    const description =
      selectedOrAllFilePaths.length === allFiles.length && !selectionTouched
        ? `Discard all ${selectedOrAllFilePaths.length} changed files?`
        : `Discard ${selectedOrAllFilePaths.length} selected files?`;
    if (!window.confirm(`${description}\n\nThis cannot be undone.`)) {
      return;
    }
    void (async () => {
      const result = await discardChangesAction.run({ filePaths: [...selectedOrAllFilePaths] });
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return;
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Discard failed",
            description: error instanceof Error ? error.message : "An error occurred.",
            ...(threadToastData !== undefined ? { data: threadToastData } : {}),
          }),
        );
        return;
      }
      resetCommitDialogState();
      toastManager.add({
        type: "success",
        title: "Changes discarded",
        description: `${selectedOrAllFilePaths.length} file${selectedOrAllFilePaths.length === 1 ? "" : "s"} updated.`,
        data: threadToastData,
      });
    })();
  };

  const runStashSelectedChanges = () => {
    if (allFiles.length === 0) return;
    const message = stashMessage.trim();
    void (async () => {
      const result = await stashPushAction.run({
        ...(message ? { message } : {}),
        ...(selectedFilePaths ? { filePaths: [...selectedFilePaths] } : {}),
      });
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return;
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Stash failed",
            description: error instanceof Error ? error.message : "An error occurred.",
            ...(threadToastData !== undefined ? { data: threadToastData } : {}),
          }),
        );
        return;
      }
      void stashListQuery.refresh();
      resetCommitDialogState();
      toastManager.add({
        type: "success",
        title: result.value.status === "stashed" ? "Changes stashed" : "No changes to stash",
        description: result.value.stashRef,
        data: threadToastData,
      });
    })();
  };

  const reportCommandFailure = useCallback(
    (title: string, result: unknown) => {
      if (
        typeof result !== "object" ||
        result === null ||
        !("_tag" in result) ||
        result._tag !== "Failure"
      ) {
        return false;
      }
      if (isAtomCommandInterrupted(result as Parameters<typeof isAtomCommandInterrupted>[0])) {
        return true;
      }
      const error = squashAtomCommandFailure(
        result as unknown as Parameters<typeof squashAtomCommandFailure>[0],
      );
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title,
          description: error instanceof Error ? error.message : "An error occurred.",
          ...(threadToastData !== undefined ? { data: threadToastData } : {}),
        }),
      );
      return true;
    },
    [threadToastData],
  );

  const createBranch = () => {
    const refName = newBranchName.trim();
    if (!refName || activeEnvironmentId === null || gitCwd === null) return;
    void (async () => {
      const result = await createRefCommand({
        environmentId: activeEnvironmentId,
        input: { cwd: gitCwd, refName, switchRef: true },
      });
      if (reportCommandFailure("Create branch failed", result)) return;
      setNewBranchName("");
      void branchRefsQuery.refresh();
      requestVcsStatusRefresh(refreshVcsStatus, activeEnvironmentId, gitCwd);
    })();
  };

  const switchBranch = (refName: string) => {
    if (activeEnvironmentId === null || gitCwd === null) return;
    void (async () => {
      const result = await switchRefCommand({
        environmentId: activeEnvironmentId,
        input: { cwd: gitCwd, refName },
      });
      if (reportCommandFailure("Switch branch failed", result)) return;
      setIsBranchDialogOpen(false);
      requestVcsStatusRefresh(refreshVcsStatus, activeEnvironmentId, gitCwd);
    })();
  };

  const deleteBranch = (branch: string, worktreePath?: string | null) => {
    if (activeEnvironmentId === null || gitCwd === null) return;
    if (!window.confirm(`Delete branch "${branch}"?`)) return;
    void (async () => {
      const result = await deleteBranchCommand({
        environmentId: activeEnvironmentId,
        input: {
          cwd: gitCwd,
          branch,
          ...(worktreePath ? { worktreePath } : {}),
        },
      });
      if (reportCommandFailure("Delete branch failed", result)) return;
      void branchRefsQuery.refresh();
      requestVcsStatusRefresh(refreshVcsStatus, activeEnvironmentId, gitCwd);
    })();
  };

  const createWorktree = () => {
    const baseRefName = newWorktreeBase.trim() || gitStatusForActions?.refName || "";
    const newRefName = newWorktreeBranch.trim();
    if (!baseRefName || !newRefName || activeEnvironmentId === null || gitCwd === null) return;
    void (async () => {
      const result = await createWorktreeCommand({
        environmentId: activeEnvironmentId,
        input: { cwd: gitCwd, refName: baseRefName, newRefName, baseRefName, path: null },
      });
      if (reportCommandFailure("Create worktree failed", result)) return;
      setNewWorktreeBranch("");
      void branchRefsQuery.refresh();
      requestVcsStatusRefresh(refreshVcsStatus, activeEnvironmentId, gitCwd);
    })();
  };

  const removeWorktree = (path: string) => {
    if (activeEnvironmentId === null || gitCwd === null) return;
    if (!window.confirm(`Remove worktree "${path}"?`)) return;
    void (async () => {
      const result = await removeWorktreeCommand({
        environmentId: activeEnvironmentId,
        input: { cwd: gitCwd, path, force: true },
      });
      if (reportCommandFailure("Remove worktree failed", result)) return;
      void branchRefsQuery.refresh();
      requestVcsStatusRefresh(refreshVcsStatus, activeEnvironmentId, gitCwd);
    })();
  };

  const applyStash = (stashRef: string, drop: boolean) => {
    void (async () => {
      const result = await stashApplyAction.run({ stashRef, drop });
      if (reportCommandFailure("Apply stash failed", result)) return;
      void stashListQuery.refresh();
    })();
  };

  const dropStash = (stashRef: string) => {
    if (!window.confirm(`Drop ${stashRef}?`)) return;
    void (async () => {
      const result = await stashDropAction.run({ stashRef });
      if (reportCommandFailure("Drop stash failed", result)) return;
      void stashListQuery.refresh();
    })();
  };

  const canPublishRepository = isRepo && gitStatusForActions !== null && !hasPrimaryRemote;

  if (!gitCwd) return null;

  return (
    <>
      {!isRepo ? (
        <Button
          variant="outline"
          size="xs"
          disabled={initAction.isPending}
          onClick={() => {
            void (async () => {
              const result = await initAction.run();
              if (result._tag === "Success" || isAtomCommandInterrupted(result)) {
                return;
              }
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Git initialization failed",
                  description: error instanceof Error ? error.message : "An error occurred.",
                  ...(threadToastData !== undefined ? { data: threadToastData } : {}),
                }),
              );
            })();
          }}
        >
          <GitBranchPlusIcon className="size-3.5" aria-hidden />
          <span className="ml-0.5">
            {initAction.isPending ? "Initializing..." : "Initialize Git"}
          </span>
        </Button>
      ) : (
        <Group aria-label="Git actions" className="shrink-0">
          {quickActionDisabledReason ? (
            <Popover>
              <PopoverTrigger
                openOnHover
                render={
                  <Button
                    aria-disabled="true"
                    className="cursor-not-allowed rounded-e-none border-e-0 opacity-64 before:rounded-e-none"
                    size="xs"
                    variant="outline"
                  />
                }
              >
                <GitQuickActionIcon
                  quickAction={quickAction}
                  SourceControlIcon={SourceControlIcon}
                />
                <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
                  {quickAction.label}
                </span>
              </PopoverTrigger>
              <PopoverPopup tooltipStyle side="bottom" align="start">
                {quickActionDisabledReason}
              </PopoverPopup>
            </Popover>
          ) : (
            <Button
              variant="outline"
              size="xs"
              disabled={isGitActionRunning || quickAction.disabled}
              onClick={runQuickAction}
            >
              <GitQuickActionIcon quickAction={quickAction} SourceControlIcon={SourceControlIcon} />
              <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
                {quickAction.label}
              </span>
            </Button>
          )}
          <GroupSeparator className="hidden @3xl/header-actions:block" />
          <Menu
            onOpenChange={(open) => {
              setIsGitMenuOpen(open);
              if (open) {
                requestVcsStatusRefresh(refreshVcsStatus, activeEnvironmentId, gitCwd);
              }
            }}
          >
            <MenuTrigger
              render={<Button aria-label="Git action options" size="icon-xs" variant="outline" />}
              disabled={isGitActionRunning}
            >
              <ChevronDownIcon aria-hidden="true" className="size-4" />
            </MenuTrigger>
            <MenuPopup align="end" className="w-full">
              {gitActionMenuItems.map((item) => {
                const disabledReason = getMenuActionDisabledReason({
                  item,
                  gitStatus: gitStatusForActions,
                  isBusy: isGitActionRunning,
                  hasPrimaryRemote,
                });
                if (item.disabled && disabledReason) {
                  return (
                    <Popover key={`${item.id}-${item.label}`}>
                      <PopoverTrigger
                        openOnHover
                        nativeButton={false}
                        render={<span className="block w-max cursor-not-allowed" />}
                      >
                        <MenuItem className="w-full" disabled>
                          <GitActionItemIcon
                            icon={item.icon}
                            SourceControlIcon={SourceControlIcon}
                          />
                          {item.label}
                        </MenuItem>
                      </PopoverTrigger>
                      <PopoverPopup tooltipStyle side="left" align="center">
                        {disabledReason}
                      </PopoverPopup>
                    </Popover>
                  );
                }

                return (
                  <MenuItem
                    key={`${item.id}-${item.label}`}
                    disabled={item.disabled}
                    onClick={() => {
                      openDialogForMenuItem(item);
                    }}
                  >
                    <GitActionItemIcon icon={item.icon} SourceControlIcon={SourceControlIcon} />
                    {item.label}
                  </MenuItem>
                );
              })}
              {canPublishRepository ? (
                <MenuItem
                  disabled={isGitActionRunning}
                  onClick={() => {
                    setIsPublishDialogOpen(true);
                  }}
                >
                  <CloudUploadIcon />
                  Publish repository...
                </MenuItem>
              ) : null}
              <MenuItem
                disabled={isGitActionRunning}
                onClick={() => {
                  setNewWorktreeBase(gitStatusForActions?.refName ?? "");
                  setIsBranchDialogOpen(true);
                }}
              >
                <GitBranchIcon />
                Branches & worktrees...
              </MenuItem>
              {stashListQuery.data?.stashes.length ? (
                <p className="px-2 pt-2 text-[10px] font-medium uppercase text-muted-foreground">
                  Stashes
                </p>
              ) : null}
              {stashListQuery.data?.stashes.slice(0, 3).map((stash) => (
                <MenuItem
                  key={stash.ref}
                  disabled={isGitActionRunning}
                  onClick={() => applyStash(stash.ref, false)}
                >
                  <RotateCcwIcon />
                  Apply {stash.ref}
                </MenuItem>
              ))}
              {gitStatusForActions?.refName === null && (
                <p className="px-2 py-1.5 text-xs text-warning">
                  Detached HEAD: create and checkout a refName to enable push and pull request
                  actions.
                </p>
              )}
              {gitStatusForActions &&
                gitStatusForActions.refName !== null &&
                !gitStatusForActions.hasWorkingTreeChanges &&
                gitStatusForActions.behindCount > 0 &&
                gitStatusForActions.aheadCount === 0 && (
                  <p className="px-2 py-1.5 text-xs text-warning">
                    Behind upstream. Pull/rebase first.
                  </p>
                )}
              {gitStatusError && (
                <p className="px-2 py-1.5 text-xs text-destructive">{gitStatusError}</p>
              )}
            </MenuPopup>
          </Menu>
        </Group>
      )}

      <Dialog
        open={isCommitDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            resetCommitDialogState();
          }
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>
              {commitDialogAction === "commit"
                ? COMMIT_DIALOG_TITLE
                : commitDialogAction === "commit_push"
                  ? "Commit & push changes"
                  : `Commit, push & create ${changeRequestTerminology.shortLabel}`}
            </DialogTitle>
            <DialogDescription>{COMMIT_DIALOG_DESCRIPTION}</DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="space-y-3 rounded-lg border border-input bg-muted/40 p-3 text-xs">
              <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
                <span className="text-muted-foreground">Branch</span>
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {gitStatusForActions?.refName ?? "(detached HEAD)"}
                  </span>
                  {isDefaultRef && (
                    <span className="text-right text-warning text-xs">
                      Warning: default refName
                    </span>
                  )}
                </span>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {isEditingFiles && allFiles.length > 0 && (
                      <Checkbox
                        checked={allSelected}
                        indeterminate={selectionTouched && !allSelected && !noneSelected}
                        onCheckedChange={() => {
                          setSelectionTouched(true);
                          setExcludedFiles(
                            !selectionTouched || excludedFiles.size === 0
                              ? new Set(allFiles.map((f) => f.path))
                              : new Set(),
                          );
                        }}
                      />
                    )}
                    <span className="text-muted-foreground">Files</span>
                    {selectionTouched && !allSelected && !isEditingFiles && (
                      <span className="text-muted-foreground">
                        ({selectedFiles.length} of {allFiles.length})
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {selectionTouched ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => {
                          setSelectionTouched(false);
                          setExcludedFiles(new Set());
                        }}
                      >
                        Reset selection
                      </Button>
                    ) : null}
                    {allFiles.length > 0 && (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setIsEditingFiles((prev) => !prev)}
                      >
                        {isEditingFiles ? "Done" : "Edit"}
                      </Button>
                    )}
                  </div>
                </div>
                {!gitStatusForActions || allFiles.length === 0 ? (
                  <p className="font-medium">none</p>
                ) : (
                  <div className="space-y-2">
                    <ScrollArea className="h-44 rounded-md border border-input bg-background">
                      <div className="space-y-1 p-1">
                        {allFiles.map((file) => {
                          const isExcluded = excludedFiles.has(file.path);
                          return (
                            <div
                              key={file.path}
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1 font-mono text-xs transition-colors hover:bg-accent/50"
                            >
                              {isEditingFiles && (
                                <Checkbox
                                  checked={!excludedFiles.has(file.path)}
                                  onCheckedChange={() => {
                                    setSelectionTouched(true);
                                    setExcludedFiles((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(file.path)) {
                                        next.delete(file.path);
                                      } else {
                                        next.add(file.path);
                                      }
                                      return next;
                                    });
                                  }}
                                />
                              )}
                              <button
                                type="button"
                                className="flex flex-1 items-center justify-between gap-3 text-left truncate"
                                onClick={() => openChangedFileInEditor(file.path)}
                              >
                                <span
                                  className={`truncate${isExcluded ? " text-muted-foreground" : ""}`}
                                >
                                  {file.path}
                                </span>
                                <span className="shrink-0">
                                  {isExcluded ? (
                                    <span className="text-muted-foreground">Excluded</span>
                                  ) : (
                                    <>
                                      <span className="text-success">+{file.insertions}</span>
                                      <span className="text-muted-foreground"> / </span>
                                      <span className="text-destructive">-{file.deletions}</span>
                                    </>
                                  )}
                                </span>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                    <div className="flex justify-end font-mono">
                      <span className="text-success">
                        +{selectedFiles.reduce((sum, f) => sum + f.insertions, 0)}
                      </span>
                      <span className="text-muted-foreground"> / </span>
                      <span className="text-destructive">
                        -{selectedFiles.reduce((sum, f) => sum + f.deletions, 0)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium">Commit message (optional)</p>
              <Textarea
                value={dialogCommitMessage}
                onChange={(event) => setDialogCommitMessage(event.target.value)}
                placeholder="Leave empty to auto-generate"
                size="sm"
              />
            </div>
            <div className="space-y-2 rounded-lg border border-input bg-background p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium">Stash or discard</p>
                  <p className="text-xs text-muted-foreground">
                    Uses the same file selection above. Reset selection means all changed files.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={allFiles.length === 0 || explicitSelectionEmpty}
                  onClick={runDiscardSelectedChanges}
                >
                  <Trash2Icon className="size-3.5" aria-hidden />
                  Discard
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={stashMessage}
                  onChange={(event) => setStashMessage(event.target.value)}
                  placeholder="Stash message (optional)"
                  className="h-8 text-xs"
                />
                <Button
                  variant="outline"
                  size="xs"
                  disabled={allFiles.length === 0 || explicitSelectionEmpty}
                  onClick={runStashSelectedChanges}
                >
                  <ArchiveIcon className="size-3.5" aria-hidden />
                  Stash
                </Button>
              </div>
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                resetCommitDialogState();
              }}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={explicitSelectionEmpty}
              onClick={runDialogActionOnNewBranch}
            >
              Run on new ref
            </Button>
            <Button size="sm" disabled={explicitSelectionEmpty} onClick={runDialogAction}>
              {commitDialogAction === "commit"
                ? "Commit"
                : commitDialogAction === "commit_push"
                  ? "Commit & push"
                  : `Commit, push & ${changeRequestTerminology.shortLabel}`}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog open={isBranchDialogOpen} onOpenChange={setIsBranchDialogOpen}>
        <DialogPopup className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Branches & worktrees</DialogTitle>
            <DialogDescription>
              Switch branches, create branches, and manage worktrees for this repository.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-3">
              <div className="space-y-2 rounded-lg border border-input bg-muted/30 p-3">
                <p className="text-xs font-medium">New branch</p>
                <div className="flex gap-2">
                  <Input
                    value={newBranchName}
                    onChange={(event) => setNewBranchName(event.target.value)}
                    placeholder="feature/my-change"
                    className="h-8 text-xs"
                  />
                  <Button size="xs" disabled={!newBranchName.trim()} onClick={createBranch}>
                    <GitBranchPlusIcon className="size-3.5" aria-hidden />
                    Create
                  </Button>
                </div>
              </div>

              <div className="space-y-2 rounded-lg border border-input bg-muted/30 p-3">
                <p className="text-xs font-medium">New worktree</p>
                <Input
                  value={newWorktreeBase}
                  onChange={(event) => setNewWorktreeBase(event.target.value)}
                  placeholder="base branch"
                  className="h-8 text-xs"
                />
                <div className="flex gap-2">
                  <Input
                    value={newWorktreeBranch}
                    onChange={(event) => setNewWorktreeBranch(event.target.value)}
                    placeholder="feature/worktree"
                    className="h-8 text-xs"
                  />
                  <Button size="xs" disabled={!newWorktreeBranch.trim()} onClick={createWorktree}>
                    Create
                  </Button>
                </div>
              </div>

              <div className="space-y-2 rounded-lg border border-input bg-muted/30 p-3">
                <p className="text-xs font-medium">Stashes</p>
                {stashListQuery.data?.stashes.length ? (
                  <div className="space-y-1">
                    {stashListQuery.data.stashes.map((stash) => (
                      <div
                        key={stash.ref}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-input bg-background px-2 py-1.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-mono text-xs">{stash.ref}</p>
                          <p className="truncate text-xs text-muted-foreground">{stash.subject}</p>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => applyStash(stash.ref, false)}
                          >
                            Apply
                          </Button>
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => applyStash(stash.ref, true)}
                          >
                            Pop
                          </Button>
                          <Button variant="ghost" size="xs" onClick={() => dropStash(stash.ref)}>
                            <Trash2Icon className="size-3.5" aria-hidden />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No stashes.</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">Local branches</p>
                <Button variant="ghost" size="xs" onClick={() => void branchRefsQuery.refresh()}>
                  <RefreshCwIcon className="size-3.5" aria-hidden />
                  Refresh
                </Button>
              </div>
              <ScrollArea className="h-[28rem] rounded-lg border border-input bg-background">
                <div className="space-y-1 p-1">
                  {branchRefsQuery.data?.refs.map((ref) => (
                    <div
                      key={ref.name}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50"
                    >
                      <button
                        type="button"
                        className="min-w-0 text-left"
                        disabled={ref.current || isGitActionRunning}
                        onClick={() => switchBranch(ref.name)}
                      >
                        <span className="block truncate font-mono text-xs">
                          {ref.current ? "✓ " : ""}
                          {ref.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {ref.worktreePath
                            ? ref.worktreePath
                            : ref.isDefault
                              ? "Default branch"
                              : "Local branch"}
                        </span>
                      </button>
                      <div className="flex gap-1">
                        {ref.worktreePath ? (
                          <Button
                            variant="ghost"
                            size="xs"
                            disabled={isGitActionRunning}
                            onClick={() => ref.worktreePath && removeWorktree(ref.worktreePath)}
                          >
                            Remove worktree
                          </Button>
                        ) : null}
                        {!ref.current && !ref.isDefault ? (
                          <Button
                            variant="ghost"
                            size="xs"
                            disabled={isGitActionRunning}
                            onClick={() => deleteBranch(ref.name, ref.worktreePath)}
                          >
                            <Trash2Icon className="size-3.5" aria-hidden />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {branchRefsQuery.isPending ? (
                    <p className="px-2 py-3 text-xs text-muted-foreground">Loading branches...</p>
                  ) : null}
                  {!branchRefsQuery.isPending && !branchRefsQuery.data?.refs.length ? (
                    <p className="px-2 py-3 text-xs text-muted-foreground">No branches found.</p>
                  ) : null}
                </div>
              </ScrollArea>
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button size="sm" onClick={() => setIsBranchDialogOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <PublishRepositoryDialog
        open={isPublishDialogOpen}
        onOpenChange={setIsPublishDialogOpen}
        environmentId={activeEnvironmentId}
        gitCwd={gitCwd}
      />

      <Dialog
        open={pendingDefaultBranchAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDefaultBranchAction(null);
          }
        }}
      >
        <DialogPopup className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {pendingDefaultBranchActionCopy?.title ?? "Run action on default refName?"}
            </DialogTitle>
            <DialogDescription>{pendingDefaultBranchActionCopy?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:flex-wrap sm:items-center">
            <Button
              className="w-full sm:mr-auto sm:w-auto"
              variant="outline"
              size="sm"
              onClick={() => setPendingDefaultBranchAction(null)}
            >
              Abort
            </Button>
            <Button
              className="min-h-8 w-full max-w-full whitespace-normal py-1.5 leading-snug sm:min-h-7 sm:w-auto"
              variant="outline"
              size="sm"
              onClick={continuePendingDefaultBranchAction}
            >
              {pendingDefaultBranchActionCopy?.continueLabel ?? "Continue"}
            </Button>
            <Button
              className="min-h-8 w-full max-w-full whitespace-normal py-1.5 leading-snug sm:min-h-7 sm:w-auto"
              size="sm"
              onClick={checkoutFeatureBranchAndContinuePendingAction}
            >
              Checkout feature branch & continue
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
