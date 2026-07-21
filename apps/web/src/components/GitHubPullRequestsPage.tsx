import type {
  EnvironmentId,
  GitHubActor,
  GitHubPullRequestAction,
  GitHubPullRequestChecksFilter,
  GitHubPullRequestCiStatus,
  GitHubPullRequestDetails,
  GitHubPullRequestLabel,
  GitHubPullRequestListItem,
  GitHubPullRequestPreset,
  GitHubPullRequestReviewFilter,
  GitHubPullRequestReviewStatus,
  GitHubPullRequestStateFilter,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { FileDiff } from "@pierre/diffs/react";
import {
  AlertCircleIcon,
  CheckCheckIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleAlertIcon,
  ClipboardIcon,
  Clock3Icon,
  EyeIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FolderGit2Icon,
  GitMergeIcon,
  GitPullRequestArrowIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  ListIcon,
  MessageCircleDashedIcon,
  MessageCircleIcon,
  MessageCircleWarningIcon,
  MessageSquareIcon,
  MinusCircleIcon,
  PencilLineIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Trash2Icon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { useTheme } from "../hooks/useTheme";
import { useClientSettings, useUpdateClientSettings } from "../hooks/useSettings";
import { usePreparePullRequestThreadAction } from "../lib/sourceControlActions";
import { useOpenPrLink } from "../lib/openPullRequestLink";
import {
  buildFileDiffRenderKey,
  getRenderablePatch,
  resolveDiffThemeName,
} from "../lib/diffRendering";
import { useAtomCommand } from "../state/use-atom-command";
import { githubPullRequestEnvironment } from "../state/githubPullRequests";
import { useEnvironmentQuery } from "../state/query";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useProjects } from "../state/entities";
import ChatMarkdown from "./ChatMarkdown";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { SidebarInset } from "./ui/sidebar";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";
import { Switch } from "./ui/switch";
import { Toggle } from "./ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { cn } from "../lib/utils";
import { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";
import {
  clearPullRequestFilters,
  pullRequestSearchToInput,
  resolvePullRequestSearch,
  type PullRequestSearch,
} from "../pullRequestRoutes";

const PRESETS: ReadonlyArray<readonly [GitHubPullRequestPreset, string]> = [
  ["mine", "Minhas PRs"],
  ["involvement", "Meu envolvimento"],
  ["review_requested", "Minha revisão"],
  ["checks_failed", "Checks falhando"],
  ["changes_requested", "Alterações pedidas"],
  ["all", "Todas acessíveis"],
] as const;

const presetLabels = new Map(PRESETS);

const stateLabels: Record<GitHubPullRequestStateFilter, string> = {
  open: "Abertas",
  closed: "Fechadas",
  merged: "Mescladas",
  all: "Todas",
};

const PR_STATE_PRESENTATION = {
  open: {
    label: "Aberta",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    Icon: GitPullRequestArrowIcon,
  },
  closed: {
    label: "Fechada",
    className: "border-border bg-muted text-muted-foreground",
    Icon: GitPullRequestClosedIcon,
  },
  merged: {
    label: "Mesclada",
    className: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    Icon: GitMergeIcon,
  },
} as const;

type PullRequestStateKey = keyof typeof PR_STATE_PRESENTATION;

function prStatePresentation(
  state: string,
): (typeof PR_STATE_PRESENTATION)[PullRequestStateKey] | null {
  if (state === "open" || state === "closed" || state === "merged") {
    return PR_STATE_PRESENTATION[state];
  }
  return null;
}

const REVIEW_DECISION_PRESENTATION: Record<
  string,
  { label: string; className: string; Icon: typeof CheckCheckIcon; tone: string }
> = {
  APPROVED: {
    label: "Aprovada",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    Icon: CheckCheckIcon,
    tone: "text-emerald-600 dark:text-emerald-300",
  },
  CHANGES_REQUESTED: {
    label: "Alterações solicitadas",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
    Icon: MessageCircleWarningIcon,
    tone: "text-destructive",
  },
  REVIEW_REQUIRED: {
    label: "Revisão pendente",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    Icon: Clock3Icon,
    tone: "text-amber-600 dark:text-amber-300",
  },
};

function reviewDecisionPresentation(decision: string | null) {
  if (!decision) {
    return {
      label: "Revisão pendente",
      className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      Icon: Clock3Icon,
      tone: "text-amber-600 dark:text-amber-300",
    } as const;
  }
  return (
    REVIEW_DECISION_PRESENTATION[decision] ?? {
      label: decision,
      className: "border-border bg-muted text-muted-foreground",
      Icon: MessageCircleDashedIcon,
      tone: "text-muted-foreground",
    }
  );
}

const REVIEW_STATE_PRESENTATION: Record<
  string,
  { label: string; className: string; tone: string; Icon: typeof CheckCheckIcon }
> = {
  APPROVED: {
    label: "Aprovou",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    tone: "text-emerald-600 dark:text-emerald-300",
    Icon: CheckCheckIcon,
  },
  CHANGES_REQUESTED: {
    label: "Pediu alterações",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
    tone: "text-destructive",
    Icon: MessageCircleWarningIcon,
  },
  COMMENTED: {
    label: "Comentou",
    className: "border-border bg-muted text-foreground",
    tone: "text-muted-foreground",
    Icon: MessageCircleIcon,
  },
  DISMISSED: {
    label: "Dispensada",
    className: "border-border bg-muted text-muted-foreground",
    tone: "text-muted-foreground",
    Icon: CircleAlertIcon,
  },
  PENDING: {
    label: "Pendente",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    tone: "text-amber-600 dark:text-amber-300",
    Icon: Clock3Icon,
  },
};

function reviewStatePresentation(state: string) {
  return (
    REVIEW_STATE_PRESENTATION[state.toUpperCase()] ?? {
      label: state,
      className: "border-border bg-muted text-muted-foreground",
      tone: "text-muted-foreground",
      Icon: MessageCircleDashedIcon,
    }
  );
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

const CI_STATUS_LABELS: Record<GitHubPullRequestCiStatus, string> = {
  success: "CI aprovado",
  failure: "CI falhou",
  pending: "CI pendente",
  none: "Sem checks de CI",
  unknown: "Status do CI desconhecido",
};

const REVIEW_STATUS_LABELS: Record<GitHubPullRequestReviewStatus, string> = {
  approved: "PR aprovada",
  changes_requested: "Alterações solicitadas",
  pending: "Revisão pendente",
  none: "Sem decisão de revisão",
  unknown: "Status da revisão desconhecido",
};

const CI_STATUS_SHORT_LABELS: Record<GitHubPullRequestCiStatus, string> = {
  success: "Aprovado",
  failure: "Falhou",
  pending: "Pendente",
  none: "Sem checks",
  unknown: "Desconhecido",
};

const REVIEW_STATUS_SHORT_LABELS: Record<GitHubPullRequestReviewStatus, string> = {
  approved: "Aprovada",
  changes_requested: "Alterações pedidas",
  pending: "Pendente",
  none: "Sem revisão",
  unknown: "Desconhecido",
};

function reviewStateLabel(state: string): string {
  const labels: Record<string, string> = {
    APPROVED: "Aprovada",
    CHANGES_REQUESTED: "Alterações solicitadas",
    COMMENTED: "Comentou",
    DISMISSED: "Dispensada",
    PENDING: "Pendente",
  };
  return labels[state.toUpperCase()] ?? state;
}

function PullRequestStatusIndicator({
  kind,
  status,
}: {
  readonly kind: "ci" | "review";
  readonly status: GitHubPullRequestCiStatus | GitHubPullRequestReviewStatus;
}) {
  const label =
    kind === "ci"
      ? CI_STATUS_LABELS[status as GitHubPullRequestCiStatus]
      : REVIEW_STATUS_LABELS[status as GitHubPullRequestReviewStatus];
  const Icon =
    kind === "ci"
      ? status === "success"
        ? CheckCircle2Icon
        : status === "failure"
          ? XCircleIcon
          : status === "none"
            ? MinusCircleIcon
            : Clock3Icon
      : status === "approved"
        ? CheckCheckIcon
        : status === "changes_requested"
          ? MessageCircleWarningIcon
          : status === "none"
            ? MinusCircleIcon
            : Clock3Icon;
  const tone =
    status === "success" || status === "approved"
      ? "text-emerald-600 dark:text-emerald-400"
      : status === "failure" || status === "changes_requested"
        ? "text-destructive"
        : status === "pending"
          ? "text-amber-600 dark:text-amber-400"
          : "text-muted-foreground";

  return (
    <span className={`inline-flex items-center gap-1 ${tone}`} title={label} aria-label={label}>
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function PullRequestMarkdown({
  text,
  className,
}: {
  readonly text: string;
  readonly className?: string;
}) {
  return (
    <ChatMarkdown
      text={text}
      cwd={undefined}
      isStreaming={false}
      className={cn(
        "text-sm [&_h1]:mt-4 [&_h1]:text-lg [&_h2]:mt-4 [&_h2]:text-base [&_h3]:text-sm [&_ol]:my-3 [&_p]:my-3 [&_pre]:my-3 [&_pre]:max-h-80 [&_ul]:my-3",
        className,
      )}
    />
  );
}

function PullRequestDescription({ body }: { readonly body: string }) {
  const [expanded, setExpanded] = useState(false);
  const canCollapse = body.length > 1_200;

  if (!body.trim()) {
    return <p className="text-sm text-muted-foreground">Esta PR não possui descrição.</p>;
  }

  return (
    <div>
      <div className={cn("relative", canCollapse && !expanded && "max-h-80 overflow-hidden")}>
        <PullRequestMarkdown text={body} />
        {canCollapse && !expanded ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-linear-to-t from-card via-card/90 to-transparent" />
        ) : null}
      </div>
      {canCollapse ? (
        <Button
          size="xs"
          variant="ghost"
          className="mt-1"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Mostrar menos" : "Mostrar descrição completa"}
        </Button>
      ) : null}
    </div>
  );
}

function csvValues(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function ErrorState({ message }: { readonly message: string }) {
  return (
    <div className="m-5 rounded-xl border border-destructive/30 bg-destructive/8 p-5 text-sm text-destructive">
      {message}
    </div>
  );
}

function EnvironmentPicker({
  environmentId,
  onChange,
}: {
  readonly environmentId: string | null;
  readonly onChange: (environmentId: string) => void;
}) {
  const { environments } = useEnvironments();
  return (
    <select
      aria-label="GitHub environment"
      className="h-8 min-w-44 rounded-md border border-input bg-background px-2 text-xs text-foreground"
      value={environmentId ?? ""}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="" disabled>
        Select environment
      </option>
      {environments.map((environment) => (
        <option key={environment.environmentId} value={environment.environmentId}>
          {environment.label}
        </option>
      ))}
    </select>
  );
}

function updateSearch(
  navigate: ReturnType<typeof useNavigate>,
  search: PullRequestSearch,
  patch: Partial<PullRequestSearch>,
) {
  void navigate({
    to: "/pull-requests",
    search: { ...search, ...patch },
  });
}

function normalizeRepositoryName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.git$/, "");
}

function groupPullRequestsByRepository(
  items: ReadonlyArray<GitHubPullRequestListItem>,
): Array<{ readonly repository: string; readonly items: GitHubPullRequestListItem[] }> {
  const groups = new Map<string, GitHubPullRequestListItem[]>();
  for (const item of items) {
    const existing = groups.get(item.repository);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(item.repository, [item]);
    }
  }
  return Array.from(groups.entries())
    .map(([repository, groupItems]) => ({ repository, items: groupItems }))
    .sort((a, b) => a.repository.localeCompare(b.repository));
}

function projectMatchesPullRequest(
  project: ReturnType<typeof useProjects>[number],
  repository: string,
): boolean {
  const identity = project.repositoryIdentity;
  if (!identity) return false;

  const requestedRepository = normalizeRepositoryName(repository);
  const qualifiedName =
    identity.owner && identity.name ? `${identity.owner}/${identity.name}` : null;
  return [qualifiedName, identity.displayName]
    .filter((value): value is string => Boolean(value))
    .some((value) => normalizeRepositoryName(value) === requestedRepository);
}

function PullRequestChatDialog({
  item,
  projects,
  open,
  onOpenChange,
}: {
  readonly item: GitHubPullRequestListItem | null;
  readonly projects: ReturnType<typeof useProjects>;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const handleNewThread = useNewThreadHandler();
  const [selectedProjectKey, setSelectedProjectKey] = useState("");
  const [preparingMode, setPreparingMode] = useState<"local" | "worktree" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isPreparing = preparingMode !== null;
  const candidates = useMemo(
    () =>
      item ? projects.filter((project) => projectMatchesPullRequest(project, item.repository)) : [],
    [item, projects],
  );
  const selectedProject =
    candidates.find(
      (project) => `${project.environmentId}\u0000${project.id}` === selectedProjectKey,
    ) ??
    candidates[0] ??
    null;
  const prepareAction = usePreparePullRequestThreadAction({
    environmentId: selectedProject?.environmentId ?? null,
    cwd: selectedProject?.workspaceRoot ?? null,
  });

  useEffect(() => {
    if (!open) return;
    setSelectedProjectKey((current) => {
      if (candidates.some((project) => `${project.environmentId}\u0000${project.id}` === current)) {
        return current;
      }
      return candidates[0] ? `${candidates[0].environmentId}\u0000${candidates[0].id}` : "";
    });
    setError(null);
  }, [candidates, open]);

  const handleOpenChat = async (mode: "local" | "worktree") => {
    if (!item || !selectedProject) return;
    if (
      mode === "local" &&
      !window.confirm(
        "Fazer checkout desta PR no projeto selecionado? Isso pode alterar a branch atual e os arquivos locais.",
      )
    ) {
      return;
    }
    setPreparingMode(mode);
    setError(null);
    const result = await prepareAction.run({ reference: String(item.number), mode });
    if (result._tag === "Failure") {
      setPreparingMode(null);
      setError(
        prepareAction.error instanceof Error
          ? prepareAction.error.message
          : "Não foi possível preparar o worktree desta PR.",
      );
      return;
    }

    try {
      await handleNewThread(scopeProjectRef(selectedProject.environmentId, selectedProject.id), {
        branch: result.value.branch,
        worktreePath: result.value.worktreePath,
        envMode: result.value.worktreePath ? "worktree" : "local",
        startFromOrigin: false,
      });
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir o chat.");
    } finally {
      setPreparingMode(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isPreparing && onOpenChange(nextOpen)}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Abrir chat com a PR</DialogTitle>
          <DialogDescription>
            Escolha um projeto local e decida se a PR deve usar um worktree reutilizável ou a branch
            do próprio projeto.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          {item ? (
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
              <div className="font-medium">{item.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {item.repository} #{item.number}
              </div>
            </div>
          ) : null}
          {candidates.length > 0 ? (
            <label className="grid gap-1.5">
              <span className="text-xs font-medium">Projeto local</span>
              <select
                aria-label="Projeto local para a pull request"
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={selectedProjectKey}
                onChange={(event) => setSelectedProjectKey(event.target.value)}
                disabled={isPreparing}
              >
                {candidates.map((project) => (
                  <option
                    key={`${project.environmentId}\u0000${project.id}`}
                    value={`${project.environmentId}\u0000${project.id}`}
                  >
                    {project.title} — {project.workspaceRoot}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              Nenhum projeto local compatível foi encontrado. Adicione ou abra esse repositório em
              um projeto antes de iniciar o chat.
            </p>
          )}
          {selectedProject ? (
            <p className="text-xs text-muted-foreground">
              Destino: <code>{selectedProject.workspaceRoot}</code>
            </p>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPreparing}>
            Cancelar
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleOpenChat("local")}
            disabled={!selectedProject || isPreparing}
          >
            {preparingMode === "local" ? "Fazendo checkout..." : "Abrir chat sem worktree"}
          </Button>
          <Button
            onClick={() => void handleOpenChat("worktree")}
            disabled={!selectedProject || isPreparing}
          >
            {preparingMode === "worktree" ? "Preparando worktree..." : "Abrir chat em worktree"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function PullRequestCard({
  item,
  search,
  environmentId,
  onOpenChat,
}: {
  readonly item: GitHubPullRequestListItem;
  readonly search: PullRequestSearch;
  readonly environmentId: EnvironmentId | null;
  readonly onOpenChat: (item: GitHubPullRequestListItem) => void;
}) {
  const openPrLink = useOpenPrLink();
  const { copyToClipboard } = useCopyToClipboard({
    target: "pull request link",
    onCopy: () =>
      toastManager.add(stackedThreadToast({ type: "success", title: "Link da PR copiado" })),
    onError: () =>
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Não foi possível copiar o link da PR",
        }),
      ),
  });
  const [expanded, setExpanded] = useState(false);
  const [owner, repo] = item.repository.split("/");
  const detailsId = `pull-request-${owner ?? "repo"}-${repo ?? "repository"}-${item.number}`;
  const statePresentation =
    item.state === "open"
      ? {
          label: "Aberta",
          className:
            "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        }
      : item.state === "merged"
        ? {
            label: "Mesclada",
            className: "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300",
          }
        : { label: "Fechada", className: "border-border bg-muted text-muted-foreground" };

  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-xs transition-colors hover:border-ring hover:bg-accent/20">
      <button
        type="button"
        className="w-full cursor-pointer rounded-lg border-0 bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => setExpanded((current) => !current)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
            <span className="truncate font-medium text-foreground">{item.repository}</span>
            <span className="font-mono text-muted-foreground">#{item.number}</span>
            <span
              className={`rounded-full border px-2 py-0.5 font-medium ${statePresentation.className}`}
            >
              {statePresentation.label}
            </span>
            {item.isDraft ? (
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                Rascunho
              </span>
            ) : null}
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            Atualizada {formatDate(item.updatedAt)}
            <ChevronDownIcon
              className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </span>
        </div>
        <h2 className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-foreground">
          {item.title}
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{item.author ? `por ${item.author}` : "Autor desconhecido"}</span>
          {item.labels.length > 0 ? (
            <span className="h-3 w-px bg-border" aria-hidden="true" />
          ) : null}
          {item.labels.map((label) => (
            <span
              key={label.name}
              className="rounded-full border border-border/70 bg-muted/50 px-2 py-0.5 text-foreground/80"
            >
              {label.name}
            </span>
          ))}
        </div>
      </button>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
        <div className="flex flex-wrap items-center gap-2" aria-label="Status da pull request">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/30 px-2 py-1 text-xs">
            <PullRequestStatusIndicator kind="ci" status={item.ciStatus} />
            <span className="text-muted-foreground">CI</span>
            <span className="font-medium text-foreground">
              {CI_STATUS_SHORT_LABELS[item.ciStatus]}
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/30 px-2 py-1 text-xs">
            <PullRequestStatusIndicator kind="review" status={item.reviewStatus} />
            <span className="text-muted-foreground">Review</span>
            <span className="font-medium text-foreground">
              {REVIEW_STATUS_SHORT_LABELS[item.reviewStatus]}
            </span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="xs" onClick={() => onOpenChat(item)}>
            <GitPullRequestIcon className="size-3.5" /> Abrir chat
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={(event) => openPrLink(event, item.url)}
            aria-label={`Abrir ${item.repository} #${item.number} no navegador`}
          >
            <ExternalLinkIcon className="size-3.5" /> Abrir na web
          </Button>
          <Button
            size="xs"
            variant="outline"
            render={
              <Link
                to="/pull-requests/$owner/$repo/$number"
                params={{
                  owner: owner ?? "",
                  repo: repo ?? "",
                  number: String(item.number),
                }}
                search={search}
              />
            }
          >
            Detalhes da PR
          </Button>
          <Button
            size="icon-xs"
            variant="outline"
            aria-label={`Copiar link da PR ${item.repository} #${item.number}`}
            title="Copiar link da PR"
            onClick={() => copyToClipboard(item.url)}
          >
            <ClipboardIcon aria-hidden="true" />
          </Button>
        </div>
      </div>
      {expanded ? (
        <PullRequestCardDetails
          id={detailsId}
          item={item}
          search={search}
          environmentId={environmentId}
        />
      ) : null}
    </article>
  );
}

function PullRequestCardDetails({
  id,
  item,
  search,
  environmentId,
}: {
  readonly id: string;
  readonly item: GitHubPullRequestListItem;
  readonly search: PullRequestSearch;
  readonly environmentId: EnvironmentId | null;
}) {
  const query = useEnvironmentQuery(
    environmentId
      ? githubPullRequestEnvironment.details({
          environmentId,
          input: { repository: item.repository, number: item.number },
        })
      : null,
  );
  const detail = query.data;
  const checks = detail?.checks ?? [];
  type ReviewerActivity = {
    author: string;
    reviews: Array<NonNullable<typeof detail>["reviews"][number]>;
    inlineComments: Array<{
      thread: NonNullable<typeof detail>["reviewThreads"][number];
      comment: NonNullable<typeof detail>["reviewThreads"][number]["comments"][number];
    }>;
  };
  const reviewerActivity = new Map<string, ReviewerActivity>();
  const reviewerFor = (author: string | null): ReviewerActivity => {
    const name = author ?? "Usuário desconhecido";
    const existing = reviewerActivity.get(name);
    if (existing) return existing;
    const activity: ReviewerActivity = { author: name, reviews: [], inlineComments: [] };
    reviewerActivity.set(name, activity);
    return activity;
  };
  for (const review of detail?.reviews ?? []) {
    if (review.body.trim()) reviewerFor(review.author?.login ?? null).reviews.push(review);
  }
  for (const thread of detail?.reviewThreads ?? []) {
    for (const comment of thread.comments) {
      if (comment.body.trim()) {
        reviewerFor(comment.author?.login ?? null).inlineComments.push({ thread, comment });
      }
    }
  }

  return (
    <div id={id} className="mt-4 border-t border-border pt-4">
      {query.error ? (
        <p className="text-sm text-destructive">Não foi possível carregar os detalhes da PR.</p>
      ) : query.isPending && !detail ? (
        <p className="text-sm text-muted-foreground">Carregando detalhes da PR...</p>
      ) : detail ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                Branch: <strong className="text-foreground">{detail.headRefName}</strong> →{" "}
                <strong className="text-foreground">{detail.baseRefName}</strong>
              </span>
              <span>
                Alterações: +{detail.additions} / -{detail.deletions} em {detail.changedFiles}{" "}
                arquivos
              </span>
            </div>
            <PullRequestDescription body={detail.body} />
            <Link
              to="/pull-requests/$owner/$repo/$number"
              params={{
                owner: item.repository.split("/")[0] ?? "",
                repo: item.repository.split("/")[1] ?? "",
                number: String(item.number),
              }}
              search={search}
              className="inline-flex text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              Abrir página completa da PR
            </Link>
            <section
              className="rounded-lg border border-primary/30 bg-primary/5 p-3"
              aria-label="Revisões"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <MessageCircleWarningIcon className="size-4 text-primary" aria-hidden="true" />
                  Revisões
                </div>
                <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">
                  {reviewerActivity.size} {reviewerActivity.size === 1 ? "revisor" : "revisores"}
                </span>
              </div>
              {reviewerActivity.size > 0 ? (
                <div className="mt-3 space-y-3">
                  {Array.from(reviewerActivity.values()).map((activity) => (
                    <article
                      key={activity.author}
                      className="rounded-md border border-border/70 bg-background/70 p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-foreground">{activity.author}</span>
                        <span className="text-xs text-muted-foreground">
                          {activity.reviews.length > 0
                            ? `${activity.reviews.length} comentário${activity.reviews.length === 1 ? "" : "s"} de revisão`
                            : "Sem comentário geral"}
                          {activity.inlineComments.length > 0
                            ? ` · ${activity.inlineComments.length} no código`
                            : ""}
                        </span>
                      </div>
                      {activity.reviews.map((review) => (
                        <div
                          key={`review-${review.submittedAt ?? review.state}-${review.body}`}
                          className="mt-3 rounded-md border border-border/60 bg-muted/30 p-3"
                        >
                          <div className="text-xs text-muted-foreground">
                            {reviewStateLabel(review.state)}
                            {review.submittedAt ? ` · ${formatDate(review.submittedAt)}` : ""}
                          </div>
                          <PullRequestMarkdown text={review.body} className="mt-2" />
                        </div>
                      ))}
                      {activity.inlineComments.length > 0 ? (
                        <div className="mt-3 border-t border-border/60 pt-3">
                          <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                            <span className="font-medium text-foreground">
                              Comentários no código
                            </span>
                            <span className="text-muted-foreground">
                              {activity.inlineComments.length}
                            </span>
                          </div>
                          <div className="space-y-2">
                            {activity.inlineComments.map(({ thread, comment }) => {
                              const line = thread.line ?? thread.originalLine;
                              return (
                                <div
                                  key={`${thread.path}-${line ?? "unknown"}-${comment.createdAt ?? comment.body}`}
                                  className="rounded-md border border-border/60 bg-muted/20 p-3"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                    <code className="min-w-0 truncate font-medium text-foreground">
                                      {thread.path}
                                      {line ? `:${line}` : ""}
                                    </code>
                                    <span
                                      className={
                                        thread.isResolved
                                          ? "text-emerald-700 dark:text-emerald-300"
                                          : thread.isOutdated
                                            ? "text-muted-foreground"
                                            : "text-amber-700 dark:text-amber-300"
                                      }
                                    >
                                      {thread.isResolved
                                        ? "Resolvido"
                                        : thread.isOutdated
                                          ? "Desatualizado"
                                          : "Aberto"}
                                    </span>
                                  </div>
                                  <PullRequestMarkdown text={comment.body} className="mt-2" />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  Nenhum comentário foi deixado nas revisões desta PR.
                </p>
              )}
            </section>
          </div>
          <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">CI</span>
              <PullRequestStatusIndicator
                kind="ci"
                status={
                  checks.length === 0
                    ? "none"
                    : checks.some((check) =>
                          ["fail", "failure", "error", "cancel"].some((value) =>
                            `${check.bucket} ${check.state}`.toLowerCase().includes(value),
                          ),
                        )
                      ? "failure"
                      : checks.some((check) =>
                            ["pending", "queue", "progress"].some((value) =>
                              `${check.bucket} ${check.state}`.toLowerCase().includes(value),
                            ),
                          )
                        ? "pending"
                        : "success"
                }
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Review</span>
              <span className="text-foreground">{detail.reviewDecision ?? "Pendente"}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Criada</span>
              <span className="text-foreground">{formatDate(detail.createdAt)}</span>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhum detalhe disponível.</p>
      )}
    </div>
  );
}

export function GitHubPullRequestsPage() {
  const routeSearch = useSearch({ from: "/pull-requests" });
  const search = resolvePullRequestSearch(routeSearch);
  const navigate = useNavigate();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const environmentId =
    search.environment ?? primaryEnvironmentId ?? environments[0]?.environmentId ?? null;
  const environmentIdForRpc = environmentId as EnvironmentId | null;
  const query = useEnvironmentQuery(
    environmentIdForRpc
      ? githubPullRequestEnvironment.list({
          environmentId: environmentIdForRpc,
          input: pullRequestSearchToInput(search),
        })
      : null,
  );
  const [chatItem, setChatItem] = useState<GitHubPullRequestListItem | null>(null);
  const groupingMode = useClientSettings((settings) => settings.pullRequestGroupingMode);
  const updateClientSettings = useUpdateClientSettings();

  const clear = () => updateSearch(navigate, search, clearPullRequestFilters(search));
  const selectPreset = (preset: PullRequestSearch["preset"]) => {
    if (!preset) return;
    if (preset === "all" && search.preset !== "all") {
      const confirmed = window.confirm(
        "Mostrar todas as PRs acessíveis, incluindo projetos sem relação direta com você?",
      );
      if (!confirmed) return;
    }
    updateSearch(navigate, search, { preset });
  };
  const list = query.data;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-6 wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]">
          <GitPullRequestIcon className="size-5 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold">Pull Requests</h1>
            <p className="text-xs text-muted-foreground">
              Escopo: {presetLabels.get(search.preset) ?? "Minhas PRs"} · via GitHub CLI
            </p>
          </div>
          <EnvironmentPicker
            environmentId={environmentId}
            onChange={(value) => updateSearch(navigate, search, { environment: value })}
          />
          <ToggleGroup
            variant="outline"
            size="xs"
            value={[groupingMode]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "flat" || next === "repository") {
                updateClientSettings({ pullRequestGroupingMode: next });
              }
            }}
          >
            <ToggleGroupItem aria-label="Listagem normal" value="flat" className="gap-1.5 px-2.5">
              <ListIcon className="size-3" />
              Lista
            </ToggleGroupItem>
            <ToggleGroupItem
              aria-label="Agrupar por repositório"
              value="repository"
              className="gap-1.5 px-2.5"
            >
              <FolderGit2Icon className="size-3" />
              Por repositório
            </ToggleGroupItem>
          </ToggleGroup>
          <Button size="xs" variant="outline" onClick={query.refresh} disabled={query.isPending}>
            <RefreshCwIcon className={cn("size-3.5", query.isPending && "animate-spin")} />
            Atualizar
          </Button>
        </header>

        <div className="shrink-0 border-b border-border px-4 py-3 sm:px-6">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(([preset, label]) => (
              <Button
                key={preset}
                size="xs"
                variant={search.preset === preset ? "default" : "outline"}
                onClick={() => selectPreset(preset)}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              aria-label="Search pull requests"
              placeholder="Buscar PRs..."
              value={search.query ?? ""}
              onChange={(event) => updateSearch(navigate, search, { query: event.target.value })}
            />
            <Input
              aria-label="Organization filter"
              placeholder="Organização"
              value={search.organization ?? ""}
              onChange={(event) =>
                updateSearch(navigate, search, { organization: event.target.value })
              }
            />
            <Input
              aria-label="Repository filter"
              placeholder="owner/repository"
              value={search.repository ?? ""}
              onChange={(event) =>
                updateSearch(navigate, search, { repository: event.target.value })
              }
            />
            <Input
              aria-label="Label filter"
              placeholder="Label"
              value={search.label ?? ""}
              onChange={(event) => updateSearch(navigate, search, { label: event.target.value })}
            />
            <select
              aria-label="Pull request state"
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value={search.state}
              onChange={(event) =>
                updateSearch(navigate, search, {
                  state: event.target.value as GitHubPullRequestStateFilter,
                })
              }
            >
              {Object.entries(stateLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="Review filter"
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value={search.review ?? ""}
              onChange={(event) =>
                event.target.value
                  ? updateSearch(navigate, search, {
                      review: event.target.value as GitHubPullRequestReviewFilter,
                    })
                  : updateSearch(navigate, search, {})
              }
            >
              <option value="">Qualquer review</option>
              <option value="required">Review necessária</option>
              <option value="approved">Aprovada</option>
              <option value="changes_requested">Alterações pedidas</option>
              <option value="none">Sem review</option>
            </select>
            <select
              aria-label="Checks filter"
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value={search.checks ?? ""}
              onChange={(event) =>
                event.target.value
                  ? updateSearch(navigate, search, {
                      checks: event.target.value as GitHubPullRequestChecksFilter,
                    })
                  : updateSearch(navigate, search, {})
              }
            >
              <option value="">Qualquer check</option>
              <option value="failure">Falhando</option>
              <option value="pending">Pendente</option>
              <option value="success">Sucesso</option>
            </select>
            <Button size="xs" variant="ghost" onClick={clear}>
              Limpar filtros
            </Button>
          </div>
        </div>

        <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
          {query.error ? <ErrorState message={query.error} /> : null}
          {query.isPending && !list ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Carregando PRs...</div>
          ) : null}
          {list && list.items.length === 0 && !query.isPending ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              Nenhuma PR encontrada para os filtros atuais.
            </div>
          ) : null}
          {groupingMode === "repository" ? (
            <div className="grid gap-6">
              {groupPullRequestsByRepository(list?.items ?? []).map((group) => (
                <section key={group.repository} aria-label={`Pull requests de ${group.repository}`}>
                  <div className="mb-2 flex items-center gap-2 text-xs">
                    <FolderGit2Icon className="size-3.5 text-muted-foreground" />
                    <span className="font-medium text-foreground">{group.repository}</span>
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      {group.items.length}
                    </span>
                  </div>
                  <div className="grid gap-2">
                    {group.items.map((item) => (
                      <PullRequestCard
                        key={`${item.repository}#${item.number}`}
                        item={item}
                        search={search}
                        environmentId={environmentIdForRpc}
                        onOpenChat={setChatItem}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="grid gap-2">
              {list?.items.map((item) => (
                <PullRequestCard
                  key={`${item.repository}#${item.number}`}
                  item={item}
                  search={search}
                  environmentId={environmentIdForRpc}
                  onOpenChat={setChatItem}
                />
              ))}
            </div>
          )}
          {list?.truncated ? (
            <div className="mt-4 flex justify-center">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  updateSearch(navigate, search, { limit: Math.min(100, search.limit + 25) })
                }
              >
                Carregar mais
              </Button>
            </div>
          ) : null}
        </main>
      </div>
      <PullRequestChatDialog
        item={chatItem}
        projects={projects}
        open={chatItem !== null}
        onOpenChange={(open) => {
          if (!open) setChatItem(null);
        }}
      />
    </SidebarInset>
  );
}

function PullRequestStatePill({ state }: { readonly state: string }) {
  const presentation = prStatePresentation(state);
  if (!presentation) return null;
  const { label, className, Icon } = presentation;
  return (
    <Badge size="sm" className={cn("gap-1", className)}>
      <Icon className="size-3" />
      {label}
    </Badge>
  );
}

function PullRequestDraftPill() {
  return (
    <Badge size="sm" className="gap-1 border-border bg-muted text-muted-foreground">
      <GitPullRequestDraftIcon className="size-3" />
      Rascunho
    </Badge>
  );
}

function PullRequestReviewPill({ decision }: { readonly decision: string | null }) {
  const { label, className, Icon } = reviewDecisionPresentation(decision);
  return (
    <Badge size="sm" className={cn("gap-1", className)}>
      <Icon className="size-3" />
      {label}
    </Badge>
  );
}

function PullRequestLocalReviewPill({
  variant,
}: {
  readonly variant: "approve" | "request_changes";
}) {
  if (variant === "approve") {
    return (
      <Badge
        size="sm"
        className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      >
        <EyeIcon className="size-3" />
        Você acabou de aprovar
      </Badge>
    );
  }
  return (
    <Badge size="sm" className="gap-1 border-destructive/30 bg-destructive/10 text-destructive">
      <AlertCircleIcon className="size-3" />
      Você pediu alterações
    </Badge>
  );
}

function PullRequestActionsPanel({
  detail,
  localReviewAction,
  onApprove,
  onRequestChanges,
  onToggleDraft,
  onClose,
  onReopen,
  onSquashMerge,
  onAutoMerge,
  onUpdateBranch,
}: {
  readonly detail: GitHubPullRequestDetails;
  readonly localReviewAction: "approve" | "request_changes" | null;
  readonly onApprove: () => void;
  readonly onRequestChanges: () => void;
  readonly onToggleDraft: () => void;
  readonly onClose: () => void;
  readonly onReopen: () => void;
  readonly onSquashMerge: () => void;
  readonly onAutoMerge: () => void;
  readonly onUpdateBranch: () => void;
}) {
  const isMerged = detail.state === "merged";
  const isClosed = detail.state === "closed";
  const reviewActiveTone = localReviewAction ?? "default";
  return (
    <section
      aria-label="Ações da pull request"
      className="space-y-3 rounded-xl border border-border p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Ações da pull request
        </h2>
        {isMerged ? (
          <Badge
            size="sm"
            className="border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300"
          >
            <GitMergeIcon className="size-3" />
            Já mesclada
          </Badge>
        ) : null}
        {isClosed && !isMerged ? (
          <Badge size="sm" className="border-border bg-muted text-muted-foreground">
            <GitPullRequestClosedIcon className="size-3" />
            Fechada
          </Badge>
        ) : null}
      </div>
      <ActionGroup label="Revisão">
        <Button
          size="xs"
          variant={reviewActiveTone === "approve" ? "default" : "outline"}
          disabled={isMerged || isClosed}
          onClick={onApprove}
        >
          <CheckCheckIcon className="size-3.5" /> Approve
        </Button>
        <Button
          size="xs"
          variant="destructive-outline"
          disabled={isMerged || isClosed}
          onClick={onRequestChanges}
        >
          <MessageCircleWarningIcon className="size-3.5" /> Request changes
        </Button>
      </ActionGroup>
      <ActionGroup label="Estado">
        <Button size="xs" variant="outline" disabled={isMerged} onClick={onToggleDraft}>
          <PencilLineIcon className="size-3.5" />
          {detail.isDraft ? "Mark ready" : "Mark draft"}
        </Button>
        {detail.state === "closed" ? (
          <Button size="xs" variant="outline" onClick={onReopen}>
            <RotateCcwIcon className="size-3.5" /> Reopen
          </Button>
        ) : (
          <Button size="xs" variant="outline" disabled={isMerged} onClick={onClose}>
            <XIcon className="size-3.5" /> Close
          </Button>
        )}
        <Button size="xs" variant="ghost" disabled={isMerged || isClosed} onClick={onUpdateBranch}>
          <RefreshCwIcon className="size-3.5" /> Update branch
        </Button>
      </ActionGroup>
      <ActionGroup label="Merge">
        <Button size="xs" variant="outline" disabled={isMerged || isClosed} onClick={onSquashMerge}>
          <GitMergeIcon className="size-3.5" /> Squash merge
        </Button>
        <Button size="xs" variant="outline" disabled={isMerged || isClosed} onClick={onAutoMerge}>
          <GitPullRequestArrowIcon className="size-3.5" /> Auto-merge
        </Button>
      </ActionGroup>
    </section>
  );
}

function ActionGroup({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function PullRequestDescriptionCard({ detail }: { readonly detail: GitHubPullRequestDetails }) {
  return (
    <article className="relative overflow-hidden rounded-xl border border-border">
      <div className="space-y-3 p-4">
        {detail.body.trim() ? (
          <PullRequestMarkdown text={detail.body} />
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileTextIcon className="size-4" />
            Esta pull request ainda não tem descrição.
          </p>
        )}
      </div>
    </article>
  );
}

function PullRequestDiff({
  patch,
  isLoading,
}: {
  readonly patch: string | undefined;
  readonly isLoading: boolean;
}) {
  const { resolvedTheme } = useTheme();
  const renderablePatch = useMemo(() => getRenderablePatch(patch, "pull-request"), [patch]);

  return (
    <DiffWorkerPoolProvider>
      <div className="diff-render-surface mt-4 min-w-0 space-y-3">
        {isLoading && !renderablePatch ? (
          <div className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">
            Carregando diff...
          </div>
        ) : renderablePatch?.kind === "files" ? (
          renderablePatch.files.map((fileDiff) => (
            <FileDiff
              key={buildFileDiffRenderKey(fileDiff)}
              className="diff-render-file"
              fileDiff={fileDiff}
              options={{
                collapsed: false,
                diffStyle: "unified",
                lineDiffType: "none",
                overflow: "scroll",
                stickyHeader: true,
                theme: resolveDiffThemeName(resolvedTheme),
                themeType: resolvedTheme,
              }}
            />
          ))
        ) : renderablePatch?.kind === "raw" ? (
          <div className="space-y-2 rounded-xl border border-border bg-background p-4">
            <p className="text-xs text-muted-foreground">{renderablePatch.reason}</p>
            <pre className="overflow-auto whitespace-pre-wrap wrap-break-word font-mono text-xs leading-5 text-muted-foreground">
              {renderablePatch.text}
            </pre>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nenhum diff encontrado.
          </div>
        )}
      </div>
    </DiffWorkerPoolProvider>
  );
}

function PullRequestEditor({
  detail,
  editTitle,
  editBody,
  showMarkdownPreview,
  onEditTitleChange,
  onEditBodyChange,
  onTogglePreview,
  onSave,
  onDiscard,
}: {
  readonly detail: GitHubPullRequestDetails;
  readonly editTitle: string;
  readonly editBody: string;
  readonly showMarkdownPreview: boolean;
  readonly onEditTitleChange: (value: string) => void;
  readonly onEditBodyChange: (value: string) => void;
  readonly onTogglePreview: (value: boolean) => void;
  readonly onSave: () => void;
  readonly onDiscard: () => void;
}) {
  const titleChanged = editTitle !== detail.title;
  const bodyChanged = editBody !== detail.body;
  const isDirty = titleChanged || bodyChanged;
  const isTitleInvalid = !editTitle.trim();
  const isMerged = detail.state === "merged";
  const titleLength = editTitle.length;
  const isTitleNearLimit = titleLength > 200;
  return (
    <section
      id="pr-editor"
      aria-label="Editar pull request"
      className="space-y-4 rounded-xl border border-border p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <PencilLineIcon className="size-4 text-muted-foreground" />
            Editar pull request
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Altere o título e a descrição em Markdown. As mudanças são enviadas para o GitHub.
          </p>
        </div>
        {isDirty ? (
          <Badge
            size="sm"
            className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          >
            <span aria-hidden="true">●</span>
            Alterações não salvas
          </Badge>
        ) : null}
      </div>
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor="pr-title" className="text-xs font-medium text-muted-foreground">
            Título
          </label>
          <span
            className={cn(
              "text-[11px] tabular-nums",
              isTitleNearLimit ? "text-amber-600 dark:text-amber-300" : "text-muted-foreground",
            )}
          >
            {titleLength}/256
          </span>
        </div>
        <Input
          id="pr-title"
          value={editTitle}
          onChange={(event) => onEditTitleChange(event.target.value)}
          placeholder="Título da pull request"
          disabled={isMerged}
          aria-invalid={isTitleInvalid || undefined}
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="pr-body" className="text-xs font-medium text-muted-foreground">
            Descrição (Markdown)
          </label>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Toggle
                size="xs"
                pressed={showMarkdownPreview}
                onPressedChange={onTogglePreview}
                aria-label="Mostrar preview do Markdown"
              >
                <EyeIcon className="size-3" />
                Preview
              </Toggle>
            </label>
          </div>
        </div>
        {showMarkdownPreview ? (
          <div className="space-y-2">
            <Textarea
              id="pr-body"
              value={editBody}
              onChange={(event) => onEditBodyChange(event.target.value)}
              placeholder="Descreva o que esta PR altera (Markdown é suportado)"
              disabled={isMerged}
              className="min-h-40 font-mono text-sm"
            />
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              {editBody.trim() ? (
                <PullRequestMarkdown text={editBody} />
              ) : (
                <p className="text-xs text-muted-foreground">Nada para visualizar ainda.</p>
              )}
            </div>
          </div>
        ) : (
          <Textarea
            id="pr-body"
            value={editBody}
            onChange={(event) => onEditBodyChange(event.target.value)}
            placeholder="Descreva o que esta PR altera (Markdown é suportado)"
            disabled={isMerged}
            className="min-h-40 font-mono text-sm"
          />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        <Button size="xs" variant="ghost" onClick={onDiscard}>
          {isDirty ? <Trash2Icon className="size-3.5" /> : <XIcon className="size-3.5" />}
          {isDirty ? "Descartar" : "Cancelar"}
        </Button>
        <Button size="xs" disabled={isTitleInvalid || !isDirty} onClick={onSave}>
          <PencilLineIcon className="size-3.5" /> Salvar edição
        </Button>
      </div>
    </section>
  );
}

function PullRequestCommentComposer({
  body,
  onBodyChange,
  asReview,
  onAsReviewChange,
  onSubmit,
}: {
  readonly body: string;
  readonly onBodyChange: (value: string) => void;
  readonly asReview: boolean;
  readonly onAsReviewChange: (value: boolean) => void;
  readonly onSubmit: () => void;
}) {
  const canSubmit = body.trim().length > 0;
  return (
    <section
      aria-label="Adicionar comentário"
      className="space-y-3 rounded-xl border border-border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label
          htmlFor="pr-comment-body"
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
        >
          <MessageSquareIcon className="size-3.5" />
          Adicionar comentário
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={asReview} onCheckedChange={onAsReviewChange} />
          Enviar como review
        </label>
      </div>
      <Textarea
        id="pr-comment-body"
        value={body}
        onChange={(event) => onBodyChange(event.target.value)}
        placeholder="Deixe um comentário na conversa desta PR… (Ctrl/Cmd + Enter para enviar)"
        className="min-h-24"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            if (canSubmit) onSubmit();
          }
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          {asReview
            ? "Será registrado como uma review do tipo comentário."
            : "Será registrado como um comentário comum."}
        </span>
        <Button size="xs" disabled={!canSubmit} onClick={onSubmit}>
          <MessageCircleIcon className="size-3.5" />
          {asReview ? "Comentar como review" : "Comentar"}
        </Button>
      </div>
    </section>
  );
}

function PullRequestMetadataPanel({
  detail,
  labels,
  assignees,
  reviewers,
  onLabelsChange,
  onAssigneesChange,
  onReviewersChange,
  onAddLabels,
  onRemoveLabel,
  onAddAssignees,
  onRemoveAssignee,
  onAddReviewers,
  onRemoveReviewer,
}: {
  readonly detail: GitHubPullRequestDetails;
  readonly labels: string;
  readonly assignees: string;
  readonly reviewers: string;
  readonly onLabelsChange: (value: string) => void;
  readonly onAssigneesChange: (value: string) => void;
  readonly onReviewersChange: (value: string) => void;
  readonly onAddLabels: (values: string[]) => void;
  readonly onRemoveLabel: (name: string) => void;
  readonly onAddAssignees: (values: string[]) => void;
  readonly onRemoveAssignee: (login: string) => void;
  readonly onAddReviewers: (values: string[]) => void;
  readonly onRemoveReviewer: (login: string) => void;
}) {
  return (
    <section
      aria-label="Metadados da pull request"
      className="space-y-4 rounded-xl border border-border p-4"
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Metadados
      </h2>
      <MetadataField
        label="Labels"
        placeholder="bug, priority"
        inputId="pr-labels"
        value={labels}
        onChange={onLabelsChange}
        onAdd={() => {
          const values = csvValues(labels);
          if (values.length === 0) return;
          onAddLabels(values);
          onLabelsChange("");
        }}
        currentItems={detail.labels.map((label: GitHubPullRequestLabel) => ({
          key: label.name,
          label: label.name,
          color: label.color ? `#${label.color}` : null,
          onRemove: () => onRemoveLabel(label.name),
        }))}
        emptyHint="Nenhuma label aplicada."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <MetadataField
          label="Assignees"
          placeholder="@me, user"
          inputId="pr-assignees"
          value={assignees}
          onChange={onAssigneesChange}
          onAdd={() => {
            const values = csvValues(assignees);
            if (values.length === 0) return;
            onAddAssignees(values);
            onAssigneesChange("");
          }}
          currentItems={detail.assignees.map((user: GitHubActor) => ({
            key: user.login,
            label: user.login,
            onRemove: () => onRemoveAssignee(user.login),
          }))}
          emptyHint="Sem assignees."
        />
        <MetadataField
          label="Reviewers"
          placeholder="user, org/team"
          inputId="pr-reviewers"
          value={reviewers}
          onChange={onReviewersChange}
          onAdd={() => {
            const values = csvValues(reviewers);
            if (values.length === 0) return;
            onAddReviewers(values);
            onReviewersChange("");
          }}
          currentItems={detail.reviewRequests.map((user: GitHubActor) => ({
            key: user.login,
            label: user.login,
            onRemove: () => onRemoveReviewer(user.login),
          }))}
          emptyHint="Nenhum reviewer atribuído."
        />
      </div>
    </section>
  );
}

function MetadataField({
  label,
  placeholder,
  inputId,
  value,
  onChange,
  onAdd,
  currentItems,
  emptyHint,
}: {
  readonly label: string;
  readonly placeholder: string;
  readonly inputId: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onAdd: () => void;
  readonly currentItems: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly color?: string | null;
    readonly onRemove: () => void;
  }>;
  readonly emptyHint: string;
}) {
  const trimmed = value.trim();
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={inputId} className="text-xs font-medium text-muted-foreground">
          {label}
        </label>
        <span className="text-[11px] text-muted-foreground">
          {currentItems.length} {currentItems.length === 1 ? "ativo" : "ativos"}
        </span>
      </div>
      {currentItems.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {currentItems.map((item) => (
            <li key={item.key}>
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs">
                {item.color ? (
                  <span
                    aria-hidden="true"
                    className="size-2 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                ) : null}
                <span className="font-medium text-foreground">{item.label}</span>
                <button
                  type="button"
                  onClick={item.onRemove}
                  aria-label={`Remover ${item.label}`}
                  className="ms-1 inline-flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <XIcon className="size-3" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-muted-foreground">{emptyHint}</p>
      )}
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="flex-1"
          onKeyDown={(event) => {
            if (event.key === "Enter" && trimmed) {
              event.preventDefault();
              onAdd();
            }
          }}
        />
        <Button size="xs" disabled={!trimmed} onClick={onAdd}>
          Adicionar
        </Button>
      </div>
    </div>
  );
}

function PullRequestSidebar({
  detail,
  projects,
  targetCwd,
  onTargetCwdChange,
  onCheckout,
}: {
  readonly detail: GitHubPullRequestDetails;
  readonly projects: ReturnType<typeof useProjects>;
  readonly targetCwd: string;
  readonly onTargetCwdChange: (value: string) => void;
  readonly onCheckout: () => void;
}) {
  return (
    <aside className="space-y-4 self-start lg:sticky lg:top-4">
      <section className="rounded-xl border border-border p-4 text-xs">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Resumo
        </h2>
        <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-2">
          <SidebarRow label="Autor" value={detail.author?.login ?? "—"} />
          <SidebarRow
            label="Branch"
            value={
              <span className="font-mono text-foreground">
                {detail.headRefName} → {detail.baseRefName}
              </span>
            }
          />
          <SidebarRow
            label="Alterações"
            value={
              <span className="font-mono text-foreground">
                <span className="text-emerald-600 dark:text-emerald-400">+{detail.additions}</span>{" "}
                / <span className="text-destructive">-{detail.deletions}</span> ·{" "}
                {detail.changedFiles} arquivos
              </span>
            }
          />
          <SidebarRow label="Review" value={detail.reviewDecision ?? "Pendente"} />
          <SidebarRow label="Mergeable" value={detail.mergeable ?? "—"} />
        </dl>
      </section>
      <section className="rounded-xl border border-border p-4 text-xs">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Checkout em projeto / worktree
        </h2>
        <select
          aria-label="Projeto de destino para checkout"
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={targetCwd}
          onChange={(event) => onTargetCwdChange(event.target.value)}
        >
          <option value="">Escolher destino…</option>
          {projects.map((project) => (
            <option
              key={`${project.environmentId}:${project.id}`}
              value={`${project.environmentId}\u0000${project.workspaceRoot}`}
            >
              {project.title} — {project.workspaceRoot}
            </option>
          ))}
        </select>
        <Button size="xs" className="mt-2 w-full" disabled={!targetCwd} onClick={onCheckout}>
          <GitPullRequestArrowIcon className="size-3.5" /> Fazer checkout
        </Button>
      </section>
    </aside>
  );
}

function SidebarRow({ label, value }: { readonly label: string; readonly value: ReactNode }) {
  return (
    <>
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-foreground">{value}</dd>
    </>
  );
}

export function GitHubPullRequestDetailsPage() {
  const {
    owner,
    repo,
    number: numberParam,
  } = useParams({ from: "/pull-requests_/$owner/$repo/$number" });
  const routeSearch = useSearch({ from: "/pull-requests_/$owner/$repo/$number" });
  const search = resolvePullRequestSearch(routeSearch);
  const navigate = useNavigate();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentId =
    search.environment ?? primaryEnvironmentId ?? environments[0]?.environmentId ?? null;
  const environmentIdForRpc = environmentId as EnvironmentId | null;
  const number = Number(numberParam);
  const reference = useMemo(
    () => ({ repository: `${owner}/${repo}`, number }),
    [number, owner, repo],
  );
  const detailQuery = useEnvironmentQuery(
    environmentIdForRpc
      ? githubPullRequestEnvironment.details({
          environmentId: environmentIdForRpc,
          input: reference,
        })
      : null,
  );
  const checksQuery = useEnvironmentQuery(
    environmentIdForRpc
      ? githubPullRequestEnvironment.checks({
          environmentId: environmentIdForRpc,
          input: reference,
        })
      : null,
  );
  const diffQuery = useEnvironmentQuery(
    environmentIdForRpc
      ? githubPullRequestEnvironment.diff({ environmentId: environmentIdForRpc, input: reference })
      : null,
  );
  const runAction = useAtomCommand(githubPullRequestEnvironment.action, { reportFailure: false });
  const checkout = useAtomCommand(githubPullRequestEnvironment.checkout, { reportFailure: false });
  const projects = useProjects();
  const [tab, setTab] = useState<"overview" | "conversation" | "checks" | "diff">("overview");
  const [body, setBody] = useState("");
  const [commentAsReview, setCommentAsReview] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [showMarkdownPreview, setShowMarkdownPreview] = useState(false);
  const [targetCwd, setTargetCwd] = useState("");
  const [labels, setLabels] = useState("");
  const [assignees, setAssignees] = useState("");
  const [reviewers, setReviewers] = useState("");
  const [localReviewAction, setLocalReviewAction] = useState<"approve" | "request_changes" | null>(
    null,
  );

  useEffect(() => {
    if (!detailQuery.data) return;
    setEditTitle(detailQuery.data.title);
    setEditBody(detailQuery.data.body);
  }, [detailQuery.data]);

  const notify = (title: string, type: "success" | "error", description?: string) => {
    toastManager.add(stackedThreadToast({ type, title, ...(description ? { description } : {}) }));
  };

  const executeAction = async (
    action: GitHubPullRequestAction,
    options: { confirmation?: string; trackReview?: "approve" | "request_changes" } = {},
  ) => {
    const { confirmation, trackReview } = options;
    if (confirmation && !window.confirm(confirmation)) return;
    const result = await runAction({ environmentId: environmentIdForRpc!, input: action });
    if (result._tag === "Failure") {
      notify("A ação falhou", "error", "O GitHub não aceitou a operação.");
      return;
    }
    if (trackReview) setLocalReviewAction(trackReview);
    if (action.kind === "comment") setBody("");
    if (action.kind === "edit") {
      setIsEditing(false);
      setShowMarkdownPreview(false);
    }
    notify("Ação concluída", "success", result.value.message);
    detailQuery.refresh();
    checksQuery.refresh();
  };

  if (detailQuery.error) return <ErrorState message={detailQuery.error} />;
  const detail = detailQuery.data;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex flex-wrap items-start gap-3 border-b border-border px-4 py-3 sm:px-6 wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void navigate({ to: "/pull-requests", search })}
          >
            ← PRs
          </Button>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{reference.repository}</span>
              <span className="font-mono">#{number}</span>
              {detail ? <PullRequestStatePill state={detail.state} /> : null}
              {detail?.isDraft ? <PullRequestDraftPill /> : null}
              {detail ? <PullRequestReviewPill decision={detail.reviewDecision} /> : null}
              {localReviewAction === "approve" ? (
                <PullRequestLocalReviewPill variant="approve" />
              ) : null}
              {localReviewAction === "request_changes" ? (
                <PullRequestLocalReviewPill variant="request_changes" />
              ) : null}
            </div>
            <h1 className="truncate text-sm font-semibold">
              {detail?.title ?? "Carregando pull request..."}
            </h1>
          </div>
          {detail ? (
            <div className="flex items-center gap-2">
              <Button
                size="icon-xs"
                variant="outline"
                aria-label="Editar pull request"
                title="Editar pull request"
                onClick={() => {
                  setTab("overview");
                  setIsEditing(true);
                  requestAnimationFrame(() =>
                    document.getElementById("pr-editor")?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    }),
                  );
                }}
              >
                <PencilLineIcon className="size-3.5" />
              </Button>
              <Button
                size="icon-xs"
                variant="outline"
                onClick={() => window.open(detail.url, "_blank", "noopener,noreferrer")}
                aria-label="Abrir no GitHub"
                title="Abrir no GitHub"
              >
                <ExternalLinkIcon />
              </Button>
            </div>
          ) : null}
        </header>
        {detailQuery.isPending && !detail ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Carregando detalhes...
          </div>
        ) : null}
        {detail ? (
          <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
            <div
              role="tablist"
              aria-label="Seções da pull request"
              className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/30 p-0.5"
            >
              {(
                [
                  { value: "overview", label: "Resumo", Icon: FileTextIcon },
                  { value: "conversation", label: "Conversa", Icon: MessageSquareIcon },
                  { value: "checks", label: "Checks", Icon: CheckCheckIcon },
                  { value: "diff", label: "Diff", Icon: GitMergeIcon },
                ] as const
              ).map(({ value, label, Icon }) => {
                const isActive = tab === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setTab(value)}
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                      isActive
                        ? "bg-background text-foreground shadow-xs/5"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5" />
                    {label}
                  </button>
                );
              })}
            </div>

            {tab === "overview" ? (
              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
                <section className="space-y-4">
                  <PullRequestActionsPanel
                    detail={detail}
                    localReviewAction={localReviewAction}
                    onApprove={() =>
                      void executeAction(
                        {
                          repository: reference.repository,
                          number,
                          kind: "review",
                          decision: "approve",
                        },
                        { trackReview: "approve" },
                      )
                    }
                    onRequestChanges={() =>
                      void executeAction(
                        {
                          repository: reference.repository,
                          number,
                          kind: "review",
                          decision: "request_changes",
                          body: "Please address the requested changes.",
                        },
                        { trackReview: "request_changes" },
                      )
                    }
                    onToggleDraft={() =>
                      void executeAction({
                        repository: reference.repository,
                        number,
                        kind: detail.isDraft ? "ready" : "draft",
                      } as GitHubPullRequestAction)
                    }
                    onClose={() =>
                      void executeAction(
                        { repository: reference.repository, number, kind: "close" },
                        { confirmation: "Fechar esta pull request?" },
                      )
                    }
                    onReopen={() =>
                      void executeAction(
                        { repository: reference.repository, number, kind: "reopen" },
                        { confirmation: "Reabrir esta pull request?" },
                      )
                    }
                    onSquashMerge={() =>
                      void executeAction(
                        {
                          repository: reference.repository,
                          number,
                          kind: "merge",
                          strategy: "squash",
                        },
                        { confirmation: "Fazer squash e merge desta pull request?" },
                      )
                    }
                    onAutoMerge={() =>
                      void executeAction(
                        {
                          repository: reference.repository,
                          number,
                          kind: "merge",
                          strategy: "merge",
                          auto: true,
                        },
                        { confirmation: "Ativar auto-merge desta pull request?" },
                      )
                    }
                    onUpdateBranch={() =>
                      void executeAction(
                        {
                          repository: reference.repository,
                          number,
                          kind: "update_branch",
                          rebase: false,
                        },
                        { confirmation: "Atualizar a branch desta pull request?" },
                      )
                    }
                  />
                  {isEditing ? (
                    <PullRequestEditor
                      detail={detail}
                      editTitle={editTitle}
                      editBody={editBody}
                      showMarkdownPreview={showMarkdownPreview}
                      onEditTitleChange={setEditTitle}
                      onEditBodyChange={setEditBody}
                      onTogglePreview={setShowMarkdownPreview}
                      onSave={() =>
                        void executeAction({
                          repository: reference.repository,
                          number,
                          kind: "edit",
                          title: editTitle.trim(),
                          body: editBody,
                        })
                      }
                      onDiscard={() => {
                        setEditTitle(detail.title);
                        setEditBody(detail.body);
                        setShowMarkdownPreview(false);
                        setIsEditing(false);
                      }}
                    />
                  ) : (
                    <PullRequestDescriptionCard detail={detail} />
                  )}
                  <PullRequestCommentComposer
                    body={body}
                    onBodyChange={setBody}
                    asReview={commentAsReview}
                    onAsReviewChange={setCommentAsReview}
                    onSubmit={() => {
                      if (!body.trim()) return;
                      if (commentAsReview) {
                        void executeAction({
                          repository: reference.repository,
                          number,
                          kind: "review",
                          decision: "comment",
                          body,
                        });
                      } else {
                        void executeAction({
                          repository: reference.repository,
                          number,
                          kind: "comment",
                          body,
                        });
                      }
                    }}
                  />
                  <PullRequestMetadataPanel
                    detail={detail}
                    labels={labels}
                    assignees={assignees}
                    reviewers={reviewers}
                    onLabelsChange={setLabels}
                    onAssigneesChange={setAssignees}
                    onReviewersChange={setReviewers}
                    onAddLabels={(values) =>
                      void executeAction({
                        repository: reference.repository,
                        number,
                        kind: "labels",
                        add: values,
                      })
                    }
                    onRemoveLabel={(name) =>
                      void executeAction({
                        repository: reference.repository,
                        number,
                        kind: "labels",
                        remove: [name],
                      })
                    }
                    onAddAssignees={(values) =>
                      void executeAction({
                        repository: reference.repository,
                        number,
                        kind: "assignees",
                        add: values,
                      })
                    }
                    onRemoveAssignee={(login) =>
                      void executeAction({
                        repository: reference.repository,
                        number,
                        kind: "assignees",
                        remove: [login],
                      })
                    }
                    onAddReviewers={(values) =>
                      void executeAction({
                        repository: reference.repository,
                        number,
                        kind: "reviewers",
                        add: values,
                      })
                    }
                    onRemoveReviewer={(login) =>
                      void executeAction({
                        repository: reference.repository,
                        number,
                        kind: "reviewers",
                        remove: [login],
                      })
                    }
                  />
                </section>
                <PullRequestSidebar
                  detail={detail}
                  projects={projects}
                  targetCwd={targetCwd}
                  onTargetCwdChange={setTargetCwd}
                  onCheckout={async () => {
                    const [targetEnvironmentId, cwd] = targetCwd.split("\u0000");
                    if (
                      !targetEnvironmentId ||
                      !cwd ||
                      !window.confirm("Fazer checkout desta PR no destino escolhido?")
                    )
                      return;
                    const result = await checkout({
                      environmentId: targetEnvironmentId as EnvironmentId,
                      input: { repository: reference.repository, number, cwd },
                    });
                    notify(
                      result._tag === "Success" ? "Checkout concluído" : "Checkout falhou",
                      result._tag === "Success" ? "success" : "error",
                    );
                  }}
                />
              </div>
            ) : null}
            {tab === "conversation" ? (
              <div className="mt-4 space-y-3">
                {detail.reviews.map((review) => {
                  const presentation = reviewStatePresentation(review.state);
                  const PresentationIcon = presentation.Icon;
                  return (
                    <article
                      key={`review-${review.author?.login ?? "unknown"}-${review.submittedAt ?? review.state}-${review.body}`}
                      className="rounded-xl border border-border p-4"
                    >
                      <header className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-medium text-foreground">
                            {review.author?.login ?? "Usuário"}
                          </span>
                          <Badge
                            size="sm"
                            className={cn("gap-1", presentation.className)}
                            title={presentation.label}
                          >
                            <PresentationIcon className="size-3" />
                            {presentation.label}
                          </Badge>
                        </div>
                        {review.submittedAt ? (
                          <span className="text-xs text-muted-foreground">
                            {formatDate(review.submittedAt)}
                          </span>
                        ) : null}
                      </header>
                      <PullRequestMarkdown
                        text={review.body || "Sem comentário."}
                        className="mt-2"
                      />
                    </article>
                  );
                })}
                {detail.comments.map((comment) => (
                  <article
                    key={`comment-${comment.author?.login ?? "unknown"}-${comment.createdAt ?? comment.body}`}
                    className="rounded-xl border border-border p-4"
                  >
                    <header className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-medium text-foreground">
                        {comment.author?.login ?? "Usuário"}
                      </span>
                      {comment.createdAt ? (
                        <span className="text-muted-foreground">
                          {formatDate(comment.createdAt)}
                        </span>
                      ) : null}
                    </header>
                    <PullRequestMarkdown text={comment.body} className="mt-2" />
                  </article>
                ))}
                {detail.reviews.length === 0 && detail.comments.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                    Nenhuma conversa encontrada.
                  </div>
                ) : null}
              </div>
            ) : null}
            {tab === "checks" ? (
              <div className="mt-4 space-y-2">
                {(() => {
                  const checks = checksQuery.data?.checks ?? detail.checks;
                  if (checks.length === 0) {
                    return (
                      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                        Nenhum check encontrado.
                      </div>
                    );
                  }
                  return checks.map((check) => {
                    const haystack = `${check.bucket} ${check.state}`.toLowerCase();
                    const isFailure = ["fail", "failure", "error", "cancel"].some((value) =>
                      haystack.includes(value),
                    );
                    const isPending = ["pending", "queue", "progress"].some((value) =>
                      haystack.includes(value),
                    );
                    const ciStatus: GitHubPullRequestCiStatus = isFailure
                      ? "failure"
                      : isPending
                        ? "pending"
                        : check.state
                          ? "success"
                          : "none";
                    return (
                      <div
                        key={`${check.name}-${check.link ?? ""}`}
                        className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-sm"
                      >
                        <PullRequestStatusIndicator kind="ci" status={ciStatus} />
                        <span className="font-medium text-foreground">{check.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {check.bucket || check.state}
                        </span>
                        {check.completedAt ? (
                          <span className="text-xs text-muted-foreground">
                            · {formatDate(check.completedAt)}
                          </span>
                        ) : null}
                        {check.link ? (
                          <a
                            className="ms-auto inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
                            href={check.link}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Abrir <ExternalLinkIcon className="size-3" />
                          </a>
                        ) : null}
                      </div>
                    );
                  });
                })()}
              </div>
            ) : null}
            {tab === "diff" ? (
              <PullRequestDiff patch={diffQuery.data?.diff} isLoading={diffQuery.isPending} />
            ) : null}
          </main>
        ) : null}
      </div>
    </SidebarInset>
  );
}
