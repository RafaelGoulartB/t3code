import type { EnvironmentId, JiraWorkItemAction, JiraWorkItemSummary } from "@t3tools/contracts";
import {
  ExternalLinkIcon,
  LayoutListIcon,
  KanbanSquareIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
} from "lucide-react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { jiraSearchToInput, resolveJiraSearch, type JiraSearch } from "../jiraRoutes";
import { useAtomCommand } from "../state/use-atom-command";
import { jiraEnvironment } from "../state/jira";
import { useEnvironmentQuery } from "../state/query";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";
import { SidebarInset } from "./ui/sidebar";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { cn } from "../lib/utils";

type JiraSearchPatch = { readonly [K in keyof JiraSearch]?: JiraSearch[K] | undefined };
function updateSearch(
  navigate: ReturnType<typeof useNavigate>,
  search: JiraSearch,
  patch: JiraSearchPatch,
) {
  const next = Object.fromEntries(
    Object.entries({ ...search, ...patch }).filter(
      ([, value]) => value !== undefined && value !== "",
    ),
  ) as JiraSearch;
  void navigate({ to: "/jira", search: next });
}

function EnvironmentPicker({
  environmentId,
  onChange,
}: {
  readonly environmentId: string | null;
  readonly onChange: (value: string) => void;
}) {
  const { environments } = useEnvironments();
  return (
    <select
      aria-label="Jira environment"
      className="h-8 max-w-44 rounded-md border border-input bg-background px-2 text-xs"
      value={environmentId ?? ""}
      onChange={(event) => onChange(event.target.value)}
    >
      {environments.map((environment) => (
        <option key={environment.environmentId} value={environment.environmentId}>
          {environment.label ?? environment.environmentId}
        </option>
      ))}
    </select>
  );
}

function WorkItemCard({
  item,
  search,
}: {
  readonly item: JiraWorkItemSummary;
  readonly search: JiraSearch;
}) {
  return (
    <Link
      to="/jira/$workItemKey"
      params={{ workItemKey: item.key }}
      search={search}
      className="block rounded-xl border bg-card p-3 shadow-sm transition-colors hover:bg-accent/50"
    >
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="font-mono">{item.key}</span>
        <span>{item.priority ?? "No priority"}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-sm font-medium">{item.summary}</p>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{item.issueType ?? "Work item"}</span>
        <span className="truncate">{item.assignee ?? "Unassigned"}</span>
      </div>
    </Link>
  );
}

function CreateWorkItemDialog({
  environmentId,
  onDone,
}: {
  readonly environmentId: EnvironmentId;
  readonly onDone: () => void;
}) {
  const projects = useEnvironmentQuery(jiraEnvironment.projects({ environmentId, input: {} }));
  const action = useAtomCommand(jiraEnvironment.action, { reportFailure: false });
  const [open, setOpen] = useState(false);
  const [projectKey, setProjectKey] = useState("");
  const [issueType, setIssueType] = useState("Task");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState("");
  const [labels, setLabels] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!projectKey || !summary.trim()) return;
    setSaving(true);
    const result = await action({
      environmentId,
      input: {
        kind: "create",
        projectKey,
        issueType,
        summary: summary.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(assignee.trim() ? { assignee: assignee.trim() } : {}),
        ...(labels.trim()
          ? {
              labels: labels
                .split(",")
                .map((label) => label.trim())
                .filter(Boolean),
            }
          : {}),
      },
    });
    setSaving(false);
    if (result._tag === "Success") {
      setOpen(false);
      setSummary("");
      setDescription("");
      setAssignee("");
      setLabels("");
      onDone();
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="xs" onClick={() => setOpen(true)}>
        <PlusIcon className="size-3.5" />
        Create work item
      </Button>
      <DialogPopup>
        <DialogPanel>
          <DialogHeader>
            <DialogTitle>Create work item</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-3">
            <select
              aria-label="Project"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={projectKey}
              onChange={(event) => setProjectKey(event.target.value)}
            >
              <option value="">Select project</option>
              {projects.data?.map((project) => (
                <option key={project.key} value={project.key}>
                  {project.key} — {project.name}
                </option>
              ))}
            </select>
            <Input
              aria-label="Summary"
              placeholder="Summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
            <Input
              aria-label="Issue type"
              placeholder="Issue type"
              value={issueType}
              onChange={(event) => setIssueType(event.target.value)}
            />
            <Textarea
              aria-label="Description"
              placeholder="Description (optional)"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <Input
              aria-label="Assignee"
              placeholder="Assignee email or account ID (optional)"
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
            />
            <Input
              aria-label="Labels"
              placeholder="Labels, comma-separated (optional)"
              value={labels}
              onChange={(event) => setLabels(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={saving || !projectKey || !summary.trim()} onClick={submit}>
              {saving ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

export function JiraPage() {
  const routeSearch = useSearch({ from: "/jira" });
  const search = resolveJiraSearch(routeSearch);
  const navigate = useNavigate();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentId = (search.environment ??
    primaryEnvironmentId ??
    environments[0]?.environmentId ??
    null) as EnvironmentId | null;
  const status = useEnvironmentQuery(
    environmentId ? jiraEnvironment.status({ environmentId, input: {} }) : null,
  );
  const workItems = useEnvironmentQuery(
    environmentId
      ? jiraEnvironment.list({ environmentId, input: jiraSearchToInput(search) })
      : null,
  );
  const projects = useEnvironmentQuery(
    environmentId ? jiraEnvironment.projects({ environmentId, input: {} }) : null,
  );
  const columns = useMemo(() => {
    const grouped = new Map<string, JiraWorkItemSummary[]>();
    for (const item of workItems.data?.items ?? []) {
      const status = item.status ?? "Uncategorized";
      grouped.set(status, [...(grouped.get(status) ?? []), item]);
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [workItems.data]);
  if (!environmentId)
    return (
      <SidebarInset className="h-dvh bg-background">
        <div className="m-auto p-8 text-center text-sm text-muted-foreground">
          No server environment is available.
        </div>
      </SidebarInset>
    );
  const usable = status.data?.state === "authenticated";
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6">
          <KanbanSquareIcon className="size-5 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold">Jira</h1>
            <p className="text-xs text-muted-foreground">Work items via Atlassian CLI</p>
          </div>
          <EnvironmentPicker
            environmentId={environmentId}
            onChange={(value) => updateSearch(navigate, search, { environment: value })}
          />
          <Button
            size="xs"
            variant="outline"
            onClick={workItems.refresh}
            disabled={workItems.isPending}
          >
            <RefreshCwIcon className={cn("size-3.5", workItems.isPending && "animate-spin")} />
            Refresh
          </Button>
          {usable ? (
            <CreateWorkItemDialog environmentId={environmentId} onDone={workItems.refresh} />
          ) : null}
        </header>
        {!usable ? (
          <main className="m-auto max-w-md p-8 text-center">
            <h2 className="text-base font-semibold">Jira is not ready</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {status.data?.message ?? "Check Jira integration settings for this server."}
            </p>
            <Button
              className="mt-4"
              size="sm"
              variant="outline"
              onClick={() => void navigate({ to: "/settings/advanced" })}
            >
              Open Advanced settings
            </Button>
          </main>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 border-b px-4 py-3 sm:px-6">
              <Button
                size="xs"
                variant={search.assignee === "mine" ? "default" : "outline"}
                onClick={() => updateSearch(navigate, search, { assignee: "mine", jql: undefined })}
              >
                Assigned to me
              </Button>
              <Button
                size="xs"
                variant={search.assignee === "all" ? "default" : "outline"}
                onClick={() => updateSearch(navigate, search, { assignee: "all", jql: undefined })}
              >
                All work items
              </Button>
              <Button
                size="xs"
                variant={search.open ? "default" : "outline"}
                onClick={() =>
                  updateSearch(navigate, search, { open: !search.open, jql: undefined })
                }
              >
                {search.open ? "Open items" : "All statuses"}
              </Button>
              <select
                aria-label="Project filter"
                className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                value={search.project ?? ""}
                onChange={(event) =>
                  updateSearch(navigate, search, {
                    project: event.target.value || undefined,
                    jql: undefined,
                  })
                }
              >
                <option value="">All projects</option>
                {projects.data?.map((project) => (
                  <option key={project.key} value={project.key}>
                    {project.key} — {project.name}
                  </option>
                ))}
              </select>
              <Input
                aria-label="Custom JQL"
                className="h-7 min-w-60 flex-1 text-xs"
                placeholder="Custom JQL (overrides filters)"
                value={search.jql ?? ""}
                onChange={(event) =>
                  updateSearch(navigate, search, { jql: event.target.value || undefined })
                }
              />
              <Button
                size="icon-xs"
                variant={search.view === "board" ? "secondary" : "ghost"}
                aria-label="Board view"
                onClick={() => updateSearch(navigate, search, { view: "board" })}
              >
                <KanbanSquareIcon className="size-3.5" />
              </Button>
              <Button
                size="icon-xs"
                variant={search.view === "list" ? "secondary" : "ghost"}
                aria-label="List view"
                onClick={() => updateSearch(navigate, search, { view: "list" })}
              >
                <LayoutListIcon className="size-3.5" />
              </Button>
            </div>
            <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
              {workItems.error ? (
                <p className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive">
                  {workItems.error}
                </p>
              ) : null}
              {workItems.isPending && !workItems.data ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  <LoaderCircleIcon className="mr-2 inline size-4 animate-spin" />
                  Loading work items…
                </div>
              ) : null}
              {workItems.data?.items.length === 0 && !workItems.isPending ? (
                <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                  No work items match the current filters.
                </div>
              ) : null}
              {search.view === "board" ? (
                <div>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Columns are grouped by the statuses returned by this query.
                  </p>
                  <div className="flex min-h-full gap-3 overflow-x-auto pb-4">
                    {columns.map(([column, items]) => (
                      <section key={column} className="w-72 shrink-0 rounded-xl bg-muted/40 p-2">
                        <div className="mb-2 flex items-center justify-between px-1">
                          <h2 className="text-xs font-semibold">{column}</h2>
                          <Badge variant="secondary">{items.length}</Badge>
                        </div>
                        <div className="grid gap-2">
                          {items.map((item) => (
                            <WorkItemCard key={item.key} item={item} search={search} />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border">
                  {workItems.data?.items.map((item) => (
                    <Link
                      key={item.key}
                      to="/jira/$workItemKey"
                      params={{ workItemKey: item.key }}
                      search={search}
                      className="flex items-center gap-3 border-b p-3 last:border-0 hover:bg-accent/50"
                    >
                      <span className="w-20 font-mono text-xs text-muted-foreground">
                        {item.key}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {item.summary}
                      </span>
                      <span className="text-xs text-muted-foreground">{item.status ?? "—"}</span>
                      <span className="hidden text-xs text-muted-foreground sm:block">
                        {item.assignee ?? "Unassigned"}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
              {workItems.data?.truncated ? (
                <p className="mt-4 text-center text-xs text-muted-foreground">
                  Results are capped at {search.limit}. Narrow your filters or use Custom JQL.
                </p>
              ) : null}
            </main>
          </>
        )}
      </div>
    </SidebarInset>
  );
}

export function JiraWorkItemDetailsPage() {
  const { workItemKey } = useParams({ from: "/jira_/$workItemKey" });
  const routeSearch = useSearch({ from: "/jira_/$workItemKey" });
  const search = resolveJiraSearch(routeSearch);
  const navigate = useNavigate();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentId = (search.environment ??
    primaryEnvironmentId ??
    environments[0]?.environmentId ??
    null) as EnvironmentId | null;
  const detail = useEnvironmentQuery(
    environmentId ? jiraEnvironment.details({ environmentId, input: { key: workItemKey } }) : null,
  );
  const comments = useEnvironmentQuery(
    environmentId ? jiraEnvironment.comments({ environmentId, input: { key: workItemKey } }) : null,
  );
  const action = useAtomCommand(jiraEnvironment.action, { reportFailure: false });
  const openInBrowser = useAtomCommand(jiraEnvironment.openInBrowser, { reportFailure: false });
  const [comment, setComment] = useState("");
  const [targetStatus, setTargetStatus] = useState("");
  const runWorkItemAction = async (input: JiraWorkItemAction) => {
    if (!environmentId) return;
    const result = await action({ environmentId, input });
    if (result._tag === "Success") {
      detail.refresh();
      comments.refresh();
    }
  };
  const submitComment = async () => {
    if (!environmentId || !comment.trim()) return;
    const result = await action({
      environmentId,
      input: { kind: "comment", key: workItemKey, body: comment.trim() },
    });
    if (result._tag === "Success") {
      setComment("");
      comments.refresh();
      detail.refresh();
    }
  };
  if (!environmentId) return null;
  const item = detail.data;
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3 sm:px-6">
          <Button size="xs" variant="ghost" onClick={() => void navigate({ to: "/jira", search })}>
            ← Jira
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{workItemKey}</span>
              {item?.status ? <Badge variant="secondary">{item.status}</Badge> : null}
            </div>
            <h1 className="truncate text-sm font-semibold">
              {item?.summary ?? "Loading work item…"}
            </h1>
          </div>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              const summary = window.prompt("Summary", item?.summary ?? "");
              if (summary === null) return;
              const description = window.prompt("Description", item?.description ?? "");
              if (description === null) return;
              const labels = window.prompt(
                "Labels (comma-separated)",
                item?.labels.join(", ") ?? "",
              );
              if (labels === null) return;
              void runWorkItemAction({
                kind: "edit",
                key: workItemKey,
                summary: summary.trim(),
                description,
                labels: labels
                  .split(",")
                  .map((label) => label.trim())
                  .filter(Boolean),
              });
            }}
          >
            Edit
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              void runWorkItemAction({ kind: "assign", key: workItemKey, assignee: "@me" })
            }
          >
            Assign to me
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              const assignee = window.prompt("Assignee email or account ID", "");
              if (assignee?.trim()) {
                void runWorkItemAction({
                  kind: "assign",
                  key: workItemKey,
                  assignee: assignee.trim(),
                });
              }
            }}
          >
            Assign
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              void runWorkItemAction({ kind: "assign", key: workItemKey, unassign: true })
            }
          >
            Unassign
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => void openInBrowser({ environmentId, input: { key: workItemKey } })}
          >
            <ExternalLinkIcon className="size-3.5" />
            Open in Jira
          </Button>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
          <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
            <section className="space-y-5">
              <div>
                <h2 className="text-sm font-semibold">Description</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                  {item?.description || "No description."}
                </p>
              </div>
              <div>
                <h2 className="text-sm font-semibold">Comments</h2>
                <div className="mt-3 grid gap-3">
                  {comments.data?.comments.map((entry, index) => (
                    <article key={entry.id ?? index} className="rounded-xl border p-3">
                      <div className="text-xs text-muted-foreground">
                        {entry.author ?? "Unknown"} {entry.createdAt ? `· ${entry.createdAt}` : ""}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{entry.body}</p>
                    </article>
                  ))}
                </div>
                <div className="mt-3 grid gap-2">
                  <Textarea
                    aria-label="Add comment"
                    placeholder="Add a comment"
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                  />
                  <Button
                    size="sm"
                    className="w-fit"
                    disabled={!comment.trim()}
                    onClick={submitComment}
                  >
                    Add comment
                  </Button>
                </div>
              </div>
            </section>
            <aside className="rounded-xl border p-4">
              <h2 className="text-sm font-semibold">Details</h2>
              <dl className="mt-3 grid gap-3 text-xs">
                <div>
                  <dt className="text-muted-foreground">Project</dt>
                  <dd>{item?.projectKey ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Type</dt>
                  <dd>{item?.issueType ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Priority</dt>
                  <dd>{item?.priority ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Assignee</dt>
                  <dd>{item?.assignee ?? "Unassigned"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Reporter</dt>
                  <dd>{item?.reporter ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Labels</dt>
                  <dd>{item?.labels.length ? item.labels.join(", ") : "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Created</dt>
                  <dd>{item?.createdAt ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Updated</dt>
                  <dd>{item?.updatedAt ?? "—"}</dd>
                </div>
              </dl>
              {item?.additionalFields.length ? (
                <div className="mt-5 border-t pt-4">
                  <h3 className="text-xs font-medium">Additional fields</h3>
                  <dl className="mt-2 grid gap-2 text-xs">
                    {item.additionalFields.map((field) => (
                      <div key={field.name}>
                        <dt className="text-muted-foreground">{field.name}</dt>
                        <dd>{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
              <div className="mt-5 border-t pt-4">
                <label className="text-xs font-medium">Change status</label>
                <div className="mt-2 flex gap-2">
                  <Input
                    aria-label="Target status"
                    placeholder="e.g. In Progress"
                    value={targetStatus}
                    onChange={(event) => setTargetStatus(event.target.value)}
                  />
                  <Button
                    size="xs"
                    disabled={!targetStatus.trim()}
                    onClick={() => {
                      if (window.confirm(`Move ${workItemKey} to ${targetStatus.trim()}?`)) {
                        void runWorkItemAction({
                          kind: "transition",
                          key: workItemKey,
                          status: targetStatus.trim(),
                        });
                        setTargetStatus("");
                      }
                    }}
                  >
                    Move
                  </Button>
                </div>
              </div>
            </aside>
          </div>
        </main>
      </div>
    </SidebarInset>
  );
}
