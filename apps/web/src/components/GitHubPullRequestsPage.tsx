import type {
  EnvironmentId,
  GitHubPullRequestAction,
  GitHubPullRequestChecksFilter,
  GitHubPullRequestReviewFilter,
  GitHubPullRequestStateFilter,
} from "@t3tools/contracts";
import { ExternalLinkIcon, GitPullRequestIcon, RefreshCwIcon } from "lucide-react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { useAtomCommand } from "../state/use-atom-command";
import { githubPullRequestEnvironment } from "../state/githubPullRequests";
import { useEnvironmentQuery } from "../state/query";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useProjects } from "../state/entities";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { SidebarInset } from "./ui/sidebar";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { cn } from "../lib/utils";
import {
  clearPullRequestFilters,
  pullRequestSearchToInput,
  resolvePullRequestSearch,
  type PullRequestSearch,
} from "../pullRequestRoutes";

const PRESETS = [
  ["all", "Todas"],
  ["mine", "Minhas PRs"],
  ["review_requested", "Minha revisão"],
  ["checks_failed", "Checks falhando"],
  ["changes_requested", "Alterações pedidas"],
] as const;

const stateLabels: Record<GitHubPullRequestStateFilter, string> = {
  open: "Abertas",
  closed: "Fechadas",
  merged: "Mescladas",
  all: "Todas",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
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

export function GitHubPullRequestsPage() {
  const routeSearch = useSearch({ from: "/pull-requests" });
  const search = resolvePullRequestSearch(routeSearch);
  const navigate = useNavigate();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
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

  const clear = () => updateSearch(navigate, search, clearPullRequestFilters(search));
  const list = query.data;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
          <GitPullRequestIcon className="size-5 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold">Pull Requests</h1>
            <p className="text-xs text-muted-foreground">Gerenciamento global via GitHub CLI</p>
          </div>
          <EnvironmentPicker
            environmentId={environmentId}
            onChange={(value) => updateSearch(navigate, search, { environment: value })}
          />
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
                onClick={() => updateSearch(navigate, search, { preset })}
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
          <div className="grid gap-2">
            {list?.items.map((item) => (
              <Link
                key={`${item.repository}#${item.number}`}
                to="/pull-requests/$owner/$repo/$number"
                params={{
                  owner: item.repository.split("/")[0] ?? "",
                  repo: item.repository.split("/")[1] ?? "",
                  number: String(item.number),
                }}
                search={search}
                className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-ring hover:bg-accent/30"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{item.repository}</span>
                  <span>#{item.number}</span>
                  <span>{item.state}</span>
                  {item.isDraft ? (
                    <span className="rounded bg-muted px-1.5 py-0.5">Draft</span>
                  ) : null}
                  <span className="ms-auto">Atualizada {formatDate(item.updatedAt)}</span>
                </div>
                <div className="mt-1 text-sm font-medium text-foreground">{item.title}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{item.author ? `por ${item.author}` : "Autor desconhecido"}</span>
                  {item.labels.map((label) => (
                    <span key={label.name} className="rounded-full bg-muted px-2 py-0.5">
                      {label.name}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
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
    </SidebarInset>
  );
}

function ActionButton({
  children,
  onClick,
}: {
  readonly children: ReactNode;
  readonly onClick: () => void;
}) {
  return (
    <Button size="xs" variant="outline" onClick={onClick}>
      {children}
    </Button>
  );
}

export function GitHubPullRequestDetailsPage() {
  const {
    owner,
    repo,
    number: numberParam,
  } = useParams({ from: "/pull-requests/$owner/$repo/$number" });
  const routeSearch = useSearch({ from: "/pull-requests/$owner/$repo/$number" });
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
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [targetCwd, setTargetCwd] = useState("");
  const [labels, setLabels] = useState("");
  const [assignees, setAssignees] = useState("");
  const [reviewers, setReviewers] = useState("");

  useEffect(() => {
    if (!detailQuery.data) return;
    setEditTitle(detailQuery.data.title);
    setEditBody(detailQuery.data.body);
  }, [detailQuery.data]);

  const notify = (title: string, type: "success" | "error", description?: string) => {
    toastManager.add(stackedThreadToast({ type, title, ...(description ? { description } : {}) }));
  };

  const executeAction = async (action: GitHubPullRequestAction, confirmation?: string) => {
    if (confirmation && !window.confirm(confirmation)) return;
    const result = await runAction({ environmentId: environmentIdForRpc!, input: action });
    if (result._tag === "Failure") {
      notify("A ação falhou", "error", "O GitHub não aceitou a operação.");
      return;
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
        <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void navigate({ to: "/pull-requests", search })}
          >
            ← PRs
          </Button>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">
              {reference.repository} #{number}
            </div>
            <h1 className="truncate text-sm font-semibold">
              {detail?.title ?? "Carregando pull request..."}
            </h1>
          </div>
          {detail ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() => window.open(detail.url, "_blank", "noopener,noreferrer")}
            >
              <ExternalLinkIcon className="size-3.5" /> GitHub
            </Button>
          ) : null}
        </header>
        {detailQuery.isPending && !detail ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Carregando detalhes...
          </div>
        ) : null}
        {detail ? (
          <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
            <div className="flex flex-wrap gap-1.5 border-b border-border pb-3">
              {(["overview", "conversation", "checks", "diff"] as const).map((value) => (
                <Button
                  key={value}
                  size="xs"
                  variant={tab === value ? "default" : "outline"}
                  onClick={() => setTab(value)}
                >
                  {value === "overview"
                    ? "Resumo"
                    : value === "conversation"
                      ? "Conversa"
                      : value === "checks"
                        ? "Checks"
                        : "Diff"}
                </Button>
              ))}
            </div>

            {tab === "overview" ? (
              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
                <section className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <ActionButton
                      onClick={() =>
                        void executeAction({
                          repository: reference.repository,
                          number,
                          kind: "review",
                          decision: "approve",
                        })
                      }
                    >
                      Approve
                    </ActionButton>
                    <ActionButton
                      onClick={() =>
                        void executeAction({
                          repository: reference.repository,
                          number,
                          kind: "review",
                          decision: "request_changes",
                          body: "Please address the requested changes.",
                        })
                      }
                    >
                      Request changes
                    </ActionButton>
                    <ActionButton
                      onClick={() =>
                        void executeAction({
                          repository: reference.repository,
                          number,
                          kind: detail.isDraft ? "ready" : "draft",
                        } as GitHubPullRequestAction)
                      }
                    >
                      {" "}
                      {detail.isDraft ? "Mark ready" : "Mark draft"}
                    </ActionButton>
                    <ActionButton
                      onClick={() =>
                        void executeAction(
                          { repository: reference.repository, number, kind: "close" },
                          "Fechar esta pull request?",
                        )
                      }
                    >
                      Close
                    </ActionButton>
                    {detail.state === "closed" ? (
                      <ActionButton
                        onClick={() =>
                          void executeAction(
                            { repository: reference.repository, number, kind: "reopen" },
                            "Reabrir esta pull request?",
                          )
                        }
                      >
                        Reopen
                      </ActionButton>
                    ) : null}
                    <ActionButton
                      onClick={() =>
                        void executeAction(
                          {
                            repository: reference.repository,
                            number,
                            kind: "merge",
                            strategy: "squash",
                          },
                          "Fazer squash e merge desta pull request?",
                        )
                      }
                    >
                      Squash merge
                    </ActionButton>
                    <ActionButton
                      onClick={() =>
                        void executeAction(
                          {
                            repository: reference.repository,
                            number,
                            kind: "merge",
                            strategy: "merge",
                            auto: true,
                          },
                          "Ativar auto-merge desta pull request?",
                        )
                      }
                    >
                      Auto-merge
                    </ActionButton>
                  </div>
                  <div className="rounded-xl border border-border p-4 text-sm leading-6 whitespace-pre-wrap">
                    {detail.body || "Sem descrição."}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Input
                      value={editTitle}
                      onChange={(event) => setEditTitle(event.target.value)}
                      aria-label="PR title"
                    />
                    <Input
                      value={editBody}
                      onChange={(event) => setEditBody(event.target.value)}
                      aria-label="PR body"
                      className="sm:col-span-2"
                    />
                    <Button
                      size="xs"
                      onClick={() =>
                        void executeAction({
                          repository: reference.repository,
                          number,
                          kind: "edit",
                          title: editTitle,
                          body: editBody,
                        })
                      }
                    >
                      Salvar edição
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      value={body}
                      onChange={(event) => setBody(event.target.value)}
                      placeholder="Adicionar comentário"
                      aria-label="Comment body"
                      className="min-w-64 flex-1"
                    />
                    <Button
                      size="xs"
                      disabled={!body.trim()}
                      onClick={() =>
                        void executeAction({
                          repository: reference.repository,
                          number,
                          kind: "comment",
                          body,
                        })
                      }
                    >
                      Comentar
                    </Button>
                  </div>
                  <div className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground" htmlFor="pr-labels">
                        Labels (vírgula)
                      </label>
                      <Input
                        id="pr-labels"
                        value={labels}
                        onChange={(event) => setLabels(event.target.value)}
                        placeholder="bug, priority"
                      />
                      <div className="flex gap-1">
                        <Button
                          size="xs"
                          onClick={() =>
                            void executeAction({
                              repository: reference.repository,
                              number,
                              kind: "labels",
                              add: csvValues(labels),
                            })
                          }
                        >
                          Adicionar
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            void executeAction({
                              repository: reference.repository,
                              number,
                              kind: "labels",
                              remove: csvValues(labels),
                            })
                          }
                        >
                          Remover
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground" htmlFor="pr-assignees">
                        Assignees (vírgula)
                      </label>
                      <Input
                        id="pr-assignees"
                        value={assignees}
                        onChange={(event) => setAssignees(event.target.value)}
                        placeholder="@me, user"
                      />
                      <div className="flex gap-1">
                        <Button
                          size="xs"
                          onClick={() =>
                            void executeAction({
                              repository: reference.repository,
                              number,
                              kind: "assignees",
                              add: csvValues(assignees),
                            })
                          }
                        >
                          Adicionar
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            void executeAction({
                              repository: reference.repository,
                              number,
                              kind: "assignees",
                              remove: csvValues(assignees),
                            })
                          }
                        >
                          Remover
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground" htmlFor="pr-reviewers">
                        Reviewers (vírgula)
                      </label>
                      <Input
                        id="pr-reviewers"
                        value={reviewers}
                        onChange={(event) => setReviewers(event.target.value)}
                        placeholder="user, org/team"
                      />
                      <div className="flex gap-1">
                        <Button
                          size="xs"
                          onClick={() =>
                            void executeAction({
                              repository: reference.repository,
                              number,
                              kind: "reviewers",
                              add: csvValues(reviewers),
                            })
                          }
                        >
                          Adicionar
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            void executeAction({
                              repository: reference.repository,
                              number,
                              kind: "reviewers",
                              remove: csvValues(reviewers),
                            })
                          }
                        >
                          Remover
                        </Button>
                      </div>
                    </div>
                  </div>
                  <ActionButton
                    onClick={() =>
                      void executeAction(
                        {
                          repository: reference.repository,
                          number,
                          kind: "update_branch",
                          rebase: false,
                        },
                        "Atualizar a branch desta pull request?",
                      )
                    }
                  >
                    Update branch
                  </ActionButton>
                </section>
                <aside className="space-y-3 rounded-xl border border-border p-4 text-xs text-muted-foreground">
                  <div>
                    <strong className="text-foreground">Autor:</strong>{" "}
                    {detail.author?.login ?? "—"}
                  </div>
                  <div>
                    <strong className="text-foreground">Branch:</strong> {detail.headRefName} →{" "}
                    {detail.baseRefName}
                  </div>
                  <div>
                    <strong className="text-foreground">Alterações:</strong> +{detail.additions} / -
                    {detail.deletions} em {detail.changedFiles} arquivos
                  </div>
                  <div>
                    <strong className="text-foreground">Review:</strong>{" "}
                    {detail.reviewDecision ?? "—"}
                  </div>
                  <div>
                    <strong className="text-foreground">Labels:</strong>{" "}
                    {detail.labels.map((label) => label.name).join(", ") || "—"}
                  </div>
                  <div className="border-t border-border pt-3">
                    <div className="mb-2 font-medium text-foreground">
                      Checkout em projeto/worktree
                    </div>
                    <select
                      className="h-8 w-full rounded-md border border-input bg-background px-2"
                      value={targetCwd}
                      onChange={(event) => setTargetCwd(event.target.value)}
                    >
                      <option value="">Escolher destino...</option>
                      {projects.map((project) => (
                        <option
                          key={`${project.environmentId}:${project.id}`}
                          value={`${project.environmentId}\u0000${project.workspaceRoot}`}
                        >
                          {project.title} — {project.workspaceRoot}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="xs"
                      className="mt-2 w-full"
                      disabled={!targetCwd}
                      onClick={async () => {
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
                    >
                      Fazer checkout
                    </Button>
                  </div>
                </aside>
              </div>
            ) : null}
            {tab === "conversation" ? (
              <div className="mt-4 space-y-3">
                {detail.reviews.map((review) => (
                  <article
                    key={`review-${review.author?.login ?? "unknown"}-${review.submittedAt ?? review.state}-${review.body}`}
                    className="rounded-xl border border-border p-4"
                  >
                    <div className="text-xs font-medium">
                      {review.author?.login ?? "Usuário"} — {review.state}
                    </div>
                    <div className="mt-2 whitespace-pre-wrap text-sm">
                      {review.body || "Sem comentário."}
                    </div>
                  </article>
                ))}
                {detail.comments.map((comment) => (
                  <article
                    key={`comment-${comment.author?.login ?? "unknown"}-${comment.createdAt ?? comment.body}`}
                    className="rounded-xl border border-border p-4"
                  >
                    <div className="text-xs font-medium">{comment.author?.login ?? "Usuário"}</div>
                    <div className="mt-2 whitespace-pre-wrap text-sm">{comment.body}</div>
                  </article>
                ))}
                {detail.reviews.length === 0 && detail.comments.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    Nenhuma conversa encontrada.
                  </div>
                ) : null}
              </div>
            ) : null}
            {tab === "checks" ? (
              <div className="mt-4 space-y-2">
                {(checksQuery.data?.checks ?? detail.checks).map((check) => (
                  <div
                    key={`${check.name}-${check.link ?? ""}`}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm"
                  >
                    <span className="font-medium">{check.name}</span>
                    <span className="text-muted-foreground">{check.bucket || check.state}</span>
                    {check.link ? (
                      <a
                        className="ms-auto text-primary underline"
                        href={check.link}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Abrir
                      </a>
                    ) : null}
                  </div>
                ))}
                {!checksQuery.data?.checks.length && !detail.checks.length ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    Nenhum check encontrado.
                  </div>
                ) : null}
              </div>
            ) : null}
            {tab === "diff" ? (
              <pre className="mt-4 overflow-auto rounded-xl border border-border bg-muted/20 p-4 text-xs leading-5">
                {diffQuery.data?.diff ?? "Carregando diff..."}
              </pre>
            ) : null}
          </main>
        ) : null}
      </div>
    </SidebarInset>
  );
}
