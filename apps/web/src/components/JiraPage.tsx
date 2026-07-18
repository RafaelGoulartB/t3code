import {
  type EnvironmentId,
  type JiraWorkItemAction,
  type JiraWorkItemDetails,
  type JiraWorkItemSummary,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  ExternalLinkIcon,
  EllipsisIcon,
  LayoutListIcon,
  KanbanSquareIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  MessageSquarePlusIcon,
} from "lucide-react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { jiraSearchToInput, resolveJiraSearch, type JiraSearch } from "../jiraRoutes";
import { useAtomCommand } from "../state/use-atom-command";
import { jiraEnvironment } from "../state/jira";
import { useEnvironmentQuery } from "../state/query";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useProjects } from "../state/entities";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useJiraWorkItemMutation } from "../hooks/useJiraWorkItemMutation";
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
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";

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
  const { run: runWorkItemAction, pendingKind } = useJiraWorkItemMutation(environmentId, [onDone]);
  const [open, setOpen] = useState(false);
  const [projectKey, setProjectKey] = useState("");
  const [issueType, setIssueType] = useState("Task");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState("");
  const [labels, setLabels] = useState("");
  const submit = async () => {
    if (!projectKey || !summary.trim()) return;
    const success = await runWorkItemAction({
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
    });
    if (success) {
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
            <Button
              disabled={pendingKind === "create" || !projectKey || !summary.trim()}
              onClick={submit}
            >
              {pendingKind === "create" ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function EditWorkItemDialog({
  item,
  onSave,
  pending,
}: {
  readonly item: JiraWorkItemDetails | null;
  readonly onSave: (input: JiraWorkItemAction) => Promise<boolean>;
  readonly pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [labels, setLabels] = useState("");
  useEffect(() => {
    if (open && item) {
      setSummary(item.summary);
      setDescription(item.description);
      setLabels(item.labels.join(", "));
    }
  }, [item, open]);
  const save = async () => {
    if (!item || !summary.trim()) return;
    const nextLabels = labels
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean);
    const changed: JiraWorkItemAction = {
      kind: "edit",
      key: item.key,
      ...(summary.trim() !== item.summary ? { summary: summary.trim() } : {}),
      ...(description !== item.description ? { description } : {}),
      ...(nextLabels.join("\u0000") !== item.labels.join("\u0000") ? { labels: nextLabels } : {}),
    };
    if (Object.keys(changed).length === 2 || (await onSave(changed))) setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="xs" variant="outline" disabled={!item} onClick={() => setOpen(true)}>
        Edit
      </Button>
      <DialogPopup>
        <DialogPanel>
          <DialogHeader>
            <DialogTitle>Edit work item</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-3">
            <Input
              aria-label="Summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
            <Textarea
              aria-label="Description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <Input
              aria-label="Labels"
              placeholder="Labels, comma-separated"
              value={labels}
              onChange={(event) => setLabels(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">Only changed fields are sent to Jira.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={pending || !summary.trim()} onClick={() => void save()}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function AssignWorkItemDialog({
  item,
  onSave,
  pending,
}: {
  readonly item: JiraWorkItemDetails | null;
  readonly onSave: (input: JiraWorkItemAction) => Promise<boolean>;
  readonly pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [assignee, setAssignee] = useState("");
  const [mode, setMode] = useState<"me" | "other" | "unassign">("me");
  const save = async () => {
    if (!item || (mode === "other" && !assignee.trim())) return;
    const input: JiraWorkItemAction =
      mode === "unassign"
        ? { kind: "assign", key: item.key, unassign: true }
        : { kind: "assign", key: item.key, assignee: mode === "me" ? "@me" : assignee.trim() };
    if (await onSave(input)) setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="xs" variant="outline" disabled={!item} onClick={() => setOpen(true)}>
        Assign
      </Button>
      <DialogPopup>
        <DialogPanel>
          <DialogHeader>
            <DialogTitle>Assign work item</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-3 text-sm">
            <label>
              <input type="radio" checked={mode === "me"} onChange={() => setMode("me")} /> Assign
              to me
            </label>
            <label>
              <input type="radio" checked={mode === "other"} onChange={() => setMode("other")} />{" "}
              Assign another person
            </label>
            {mode === "other" ? (
              <Input
                aria-label="Assignee email or account ID"
                placeholder="Email or account ID"
                value={assignee}
                onChange={(event) => setAssignee(event.target.value)}
              />
            ) : null}
            <label>
              <input
                type="radio"
                checked={mode === "unassign"}
                onChange={() => setMode("unassign")}
              />{" "}
              Unassign
            </label>
            <p className="text-xs text-muted-foreground">
              This changes who owns {item?.key} in Jira.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending || (mode === "other" && !assignee.trim())}
              onClick={() => void save()}
            >
              {pending ? "Updating…" : "Confirm assignment"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function TransitionWorkItemDialog({
  item,
  suggestions,
  onSave,
  pending,
}: {
  readonly item: JiraWorkItemDetails | null;
  readonly suggestions: ReadonlyArray<string>;
  readonly onSave: (input: JiraWorkItemAction) => Promise<boolean>;
  readonly pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const save = async () => {
    if (
      item &&
      status.trim() &&
      (await onSave({ kind: "transition", key: item.key, status: status.trim() }))
    ) {
      setOpen(false);
      setStatus("");
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="xs" variant="outline" disabled={!item} onClick={() => setOpen(true)}>
        Change status
      </Button>
      <DialogPopup>
        <DialogPanel>
          <DialogHeader>
            <DialogTitle>Change status</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-3">
            <p className="text-sm text-muted-foreground">
              {item?.key}: {item?.status ?? "Unknown"} → requested status
            </p>
            <Input
              aria-label="Target status"
              list="jira-status-suggestions"
              placeholder="e.g. In Progress"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            />
            <datalist id="jira-status-suggestions">
              {suggestions.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">
              Jira will validate this workflow transition.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={pending || !status.trim()} onClick={() => void save()}>
              {pending ? "Moving…" : "Confirm status"}
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
  const sprints = useEnvironmentQuery(
    environmentId
      ? jiraEnvironment.sprints({
          environmentId,
          input: search.project ? { projectKey: search.project } : {},
        })
      : null,
  );
  const sprintQueryInput = search.jql
    ? { mode: "jql" as const, jql: search.jql, limit: search.limit }
    : {
        mode: "filters" as const,
        assignee: search.assignee,
        openOnly: search.open,
        ...(search.project ? { projectKey: search.project } : {}),
        limit: search.limit,
      };
  const sprintGroups = useEnvironmentQuery(
    environmentId && search.view === "list" && sprints.data?.length
      ? jiraEnvironment.sprintWorkItems({
          environmentId,
          input: {
            sprints: search.sprint
              ? sprints.data.filter((sprint) => sprint.id === search.sprint)
              : sprints.data
                  .filter((sprint) => sprint.state === "active" || sprint.state === "future")
                  .slice(0, 8),
            input: sprintQueryInput,
          },
        })
      : null,
  );
  const selectedSprint = sprints.data?.find((sprint) => sprint.id === search.sprint) ?? null;
  const activeSprint = sprints.data?.find((sprint) => sprint.state === "active") ?? null;
  const columns = useMemo(() => {
    const grouped = new Map<string, JiraWorkItemSummary[]>();
    for (const item of workItems.data?.items ?? []) {
      const status = item.status ?? "Uncategorized";
      grouped.set(status, [...(grouped.get(status) ?? []), item]);
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [workItems.data]);
  const sprintSummary = useMemo(() => {
    const items = workItems.data?.items ?? [];
    const statusCount = (needle: string) =>
      items.filter((item) => item.status?.toLowerCase().includes(needle)).length;
    return {
      total: items.length,
      todo: statusCount("to do") + statusCount("todo"),
      inProgress: statusCount("progress"),
      done: statusCount("done"),
      unassigned: items.filter((item) => !item.assignee).length,
    };
  }, [workItems.data]);
  const nextUp = useMemo(() => {
    const rank = (priority: string | null) =>
      ({ highest: 0, high: 1, medium: 2, low: 3, lowest: 4 })[priority?.toLowerCase() ?? ""] ?? 5;
    return [...(workItems.data?.items ?? [])]
      .filter((item) => item.assignee && !item.status?.toLowerCase().includes("done"))
      .sort(
        (left, right) =>
          rank(left.priority) - rank(right.priority) || left.key.localeCompare(right.key),
      )
      .slice(0, 5);
  }, [workItems.data]);
  const outsideSprints = useMemo(() => {
    const groupedKeys = new Set(
      sprintGroups.data?.flatMap((group) => group.items.map((item) => item.key)) ?? [],
    );
    return (workItems.data?.items ?? []).filter((item) => !groupedKeys.has(item.key));
  }, [sprintGroups.data, workItems.data]);
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
              {activeSprint ? (
                <Button
                  size="xs"
                  variant={search.sprint === activeSprint.id ? "default" : "outline"}
                  onClick={() =>
                    updateSearch(navigate, search, {
                      assignee: "mine",
                      open: true,
                      sprint: activeSprint.id,
                      jql: undefined,
                    })
                  }
                >
                  My active sprint
                </Button>
              ) : null}
              <Button
                size="xs"
                variant={
                  !search.sprint && search.assignee === "mine" && search.open
                    ? "default"
                    : "outline"
                }
                onClick={() =>
                  updateSearch(navigate, search, {
                    assignee: "mine",
                    open: true,
                    sprint: undefined,
                    jql: undefined,
                  })
                }
              >
                My open work items
              </Button>
              <Button
                size="xs"
                variant={search.assignee === "all" && !search.open ? "default" : "outline"}
                onClick={() =>
                  updateSearch(navigate, search, {
                    assignee: "all",
                    open: false,
                    sprint: undefined,
                    jql: undefined,
                  })
                }
              >
                All work items
              </Button>
              <select
                aria-label="Work item status"
                className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                value={search.open ? "open" : "all"}
                onChange={(event) =>
                  updateSearch(navigate, search, {
                    open: event.target.value === "open",
                    jql: undefined,
                  })
                }
              >
                <option value="open">Open only</option>
                <option value="all">Include completed</option>
              </select>
              <select
                aria-label="Project filter"
                className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                value={search.project ?? ""}
                onChange={(event) =>
                  updateSearch(navigate, search, {
                    project: event.target.value || undefined,
                    sprint: undefined,
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
              <select
                aria-label="Sprint filter"
                className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                value={search.sprint ?? ""}
                onChange={(event) =>
                  updateSearch(navigate, search, {
                    sprint: event.target.value ? Number(event.target.value) : undefined,
                    jql: undefined,
                  })
                }
              >
                <option value="">All sprints</option>
                {sprints.data?.map((sprint) => (
                  <option key={sprint.id} value={sprint.id}>
                    {sprint.name} ({sprint.state})
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
              {activeSprint && !search.jql ? (
                <section className="mb-4 rounded-xl border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold">My sprint</h2>
                      <p className="text-xs text-muted-foreground">{activeSprint.name}</p>
                    </div>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        updateSearch(navigate, search, {
                          sprint: activeSprint.id,
                          assignee: "mine",
                          open: true,
                        })
                      }
                    >
                      Focus sprint
                    </Button>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {[
                      ["Total", sprintSummary.total],
                      ["To Do", sprintSummary.todo],
                      ["In Progress", sprintSummary.inProgress],
                      ["Done", sprintSummary.done],
                      ["Unassigned", sprintSummary.unassigned],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-lg border bg-background p-2">
                        <p className="text-[11px] text-muted-foreground">{label}</p>
                        <p className="text-lg font-semibold">{value}</p>
                      </div>
                    ))}
                  </div>
                  {nextUp.length ? (
                    <div className="mt-4">
                      <h3 className="text-xs font-semibold">Next up</h3>
                      <div className="mt-2 grid gap-2">
                        {nextUp.map((item) => (
                          <Link
                            key={item.key}
                            to="/jira/$workItemKey"
                            params={{ workItemKey: item.key }}
                            search={search}
                            className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm hover:bg-accent/50"
                          >
                            <span className="min-w-0 truncate">
                              <span className="mr-2 font-mono text-xs text-muted-foreground">
                                {item.key}
                              </span>
                              {item.summary}
                            </span>
                            <span className="text-xs text-muted-foreground">Open</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : !activeSprint && !search.jql ? (
                <p className="mb-4 text-xs text-muted-foreground">
                  No active sprint was found. Showing your open work items instead.
                </p>
              ) : null}
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
                <div className="space-y-3">
                  {(sprintGroups.data ?? []).map((group) => (
                    <section
                      key={`${group.sprint.boardId}-${group.sprint.id}`}
                      className="overflow-hidden rounded-xl border"
                    >
                      <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
                        <h2 className="text-xs font-semibold">{group.sprint.name}</h2>
                        <span className="text-xs text-muted-foreground">
                          {group.sprint.state} · {group.items.length}
                        </span>
                      </div>
                      {group.items.map((item) => (
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
                          <span className="text-xs text-muted-foreground">
                            {item.status ?? "—"}
                          </span>
                        </Link>
                      ))}
                    </section>
                  ))}
                  {outsideSprints.length ? (
                    <section className="overflow-hidden rounded-xl border">
                      <div className="border-b bg-muted/30 px-3 py-2">
                        <h2 className="text-xs font-semibold">Outside active and future sprints</h2>
                      </div>
                      {outsideSprints.map((item) => (
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
                        </Link>
                      ))}
                    </section>
                  ) : null}
                  {!sprintGroups.data?.length ? (
                    <section className="overflow-hidden rounded-xl border">
                      <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
                        <h2 className="text-xs font-semibold">
                          {selectedSprint?.name ?? "Query results"}
                        </h2>
                        {selectedSprint ? (
                          <span className="text-xs text-muted-foreground">
                            {selectedSprint.state}
                          </span>
                        ) : null}
                      </div>
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
                          <span className="text-xs text-muted-foreground">
                            {item.status ?? "—"}
                          </span>
                          <span className="hidden text-xs text-muted-foreground sm:block">
                            {item.assignee ?? "Unassigned"}
                          </span>
                        </Link>
                      ))}
                    </section>
                  ) : null}
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

function JiraWorkItemOverflowMenu({
  item,
  workItemKey,
}: {
  readonly item: JiraWorkItemDetails | null;
  readonly workItemKey: string;
}) {
  const projects = useProjects();
  const handleNewThread = useNewThreadHandler();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidates = useMemo(() => {
    const query = projectQuery.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter((project) =>
      `${project.title} ${project.workspaceRoot}`.toLowerCase().includes(query),
    );
  }, [projectQuery, projects]);
  const startThread = async (project: (typeof projects)[number]) => {
    setCreating(true);
    setError(null);
    try {
      const title = item?.summary ? `${workItemKey}: ${item.summary}` : workItemKey;
      const description = item?.description.trim() || "No description provided.";
      await handleNewThread(scopeProjectRef(project.environmentId, project.id), {
        initialPrompt: `Jira work item: ${title}\n\nDescription:\n${description}`,
      });
      setPickerOpen(false);
      setProjectQuery("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not start a thread for this project.",
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Menu>
        <MenuTrigger
          aria-label="More Jira work item actions"
          className="inline-flex size-7 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <EllipsisIcon className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={() => setPickerOpen(true)}>
            <MessageSquarePlusIcon />
            Start thread
          </MenuItem>
        </MenuPopup>
      </Menu>
      <Dialog open={pickerOpen} onOpenChange={(open) => !creating && setPickerOpen(open)}>
        <DialogPopup>
          <DialogPanel>
            <DialogHeader>
              <DialogTitle>Start thread</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-3">
              <p className="text-sm text-muted-foreground">
                Choose a project. The Jira work item title and description will be added to the new
                thread's message box.
              </p>
              <Input
                aria-label="Search projects"
                autoFocus
                placeholder="Search projects"
                value={projectQuery}
                onChange={(event) => setProjectQuery(event.target.value)}
              />
              <div className="max-h-64 overflow-y-auto rounded-md border">
                {candidates.map((project) => (
                  <button
                    key={`${project.environmentId}\u0000${project.id}`}
                    type="button"
                    disabled={creating}
                    className="flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent disabled:opacity-60"
                    onClick={() => void startThread(project)}
                  >
                    <span className="font-medium">{project.title}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {project.workspaceRoot}
                    </span>
                  </button>
                ))}
                {candidates.length === 0 ? (
                  <p className="p-4 text-center text-sm text-muted-foreground">
                    No projects match your search.
                  </p>
                ) : null}
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPickerOpen(false)} disabled={creating}>
                Cancel
              </Button>
            </DialogFooter>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
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
  const openInBrowser = useAtomCommand(jiraEnvironment.openInBrowser, { reportFailure: false });
  const item = detail.data;
  const [comment, setComment] = useState("");
  const [localComments, setLocalComments] = useState<
    ReadonlyArray<{
      readonly id: string;
      readonly body: string;
      readonly state: "sending" | "sent" | "failed";
    }>
  >([]);
  const refreshTimers = useRef<ReadonlyArray<ReturnType<typeof setTimeout>>>([]);
  const { run: runWorkItemAction, pendingKind } = useJiraWorkItemMutation(environmentId, [
    detail.refresh,
    comments.refresh,
  ]);
  const statusSuggestions = useMemo(
    () => [
      ...new Set(
        [item?.status, "To Do", "In Progress", "Done"].filter((value): value is string =>
          Boolean(value),
        ),
      ),
    ],
    [item?.status],
  );
  useEffect(() => () => refreshTimers.current.forEach(clearTimeout), []);
  useEffect(() => {
    const confirmed = comments.data?.comments ?? [];
    if (confirmed.length > 0) {
      setLocalComments((pending) =>
        pending.filter((entry) => !confirmed.some((comment) => comment.body === entry.body)),
      );
    }
  }, [comments.data]);
  const submitComment = async (body = comment.trim(), retryId?: string) => {
    if (!body) return;
    const id = retryId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setLocalComments((entries) => [
      ...entries.filter((entry) => entry.id !== id),
      { id, body, state: "sending" },
    ]);
    if (!retryId) setComment("");
    const success = await runWorkItemAction({ kind: "comment", key: workItemKey, body });
    if (!success) {
      setLocalComments((entries) =>
        entries.map((entry) => (entry.id === id ? { ...entry, state: "failed" } : entry)),
      );
      if (!comment.trim()) setComment(body);
      return;
    }
    comments.refresh();
    detail.refresh();
    refreshTimers.current.forEach(clearTimeout);
    refreshTimers.current = [500, 1500, 3000].map((delay) =>
      setTimeout(() => comments.refresh(), delay),
    );
    window.setTimeout(() => {
      setLocalComments((entries) =>
        entries.map((entry) =>
          entry.id === id && entry.state === "sending" ? { ...entry, state: "sent" } : entry,
        ),
      );
    }, 3500);
  };
  if (!environmentId) return null;
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
          <EditWorkItemDialog
            item={item}
            onSave={runWorkItemAction}
            pending={pendingKind === "edit"}
          />
          <AssignWorkItemDialog
            item={item}
            onSave={runWorkItemAction}
            pending={pendingKind === "assign"}
          />
          <TransitionWorkItemDialog
            item={item}
            suggestions={statusSuggestions}
            onSave={runWorkItemAction}
            pending={pendingKind === "transition"}
          />
          <Button
            size="xs"
            variant="outline"
            disabled={detail.isPending || comments.isPending}
            onClick={() => {
              detail.refresh();
              comments.refresh();
            }}
          >
            <RefreshCwIcon
              className={cn("size-3.5", (detail.isPending || comments.isPending) && "animate-spin")}
            />
            Refresh
          </Button>
          <JiraWorkItemOverflowMenu item={item} workItemKey={workItemKey} />
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
            <section className="flex flex-col gap-5">
              <div>
                <h2 className="text-sm font-semibold">Description</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                  {item?.description || "No description."}
                </p>
              </div>
              <div className="order-last">
                <h2 className="text-sm font-semibold">Comments</h2>
                {comments.error ? (
                  <p className="mt-3 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
                    Could not load comments from Jira. {comments.error}
                  </p>
                ) : null}
                <div className="mt-3 grid gap-3">
                  {comments.data?.comments.map((entry, index) => (
                    <article key={entry.id ?? index} className="rounded-xl border p-3">
                      <div className="text-xs text-muted-foreground">
                        {entry.author ?? "Unknown"} {entry.createdAt ? `· ${entry.createdAt}` : ""}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{entry.body}</p>
                    </article>
                  ))}
                  {localComments.map((entry) => (
                    <article key={entry.id} className="rounded-xl border border-dashed p-3">
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>You</span>
                        <span>
                          {entry.state === "sending"
                            ? "Sending to Jira…"
                            : entry.state === "sent"
                              ? "Sent to Jira — refresh to verify"
                              : "Could not send"}
                        </span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{entry.body}</p>
                      {entry.state === "failed" ? (
                        <Button
                          size="xs"
                          variant="outline"
                          className="mt-2"
                          onClick={() => void submitComment(entry.body, entry.id)}
                        >
                          Retry
                        </Button>
                      ) : null}
                    </article>
                  ))}
                  {!comments.error &&
                  comments.data?.comments.length === 0 &&
                  localComments.length === 0 ? (
                    <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                      No comments yet.
                    </p>
                  ) : null}
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
                    disabled={!comment.trim() || pendingKind === "comment"}
                    onClick={() => void submitComment()}
                  >
                    {pendingKind === "comment" ? "Sending…" : "Add comment"}
                  </Button>
                </div>
              </div>
              <div>
                <h2 className="text-sm font-semibold">Subtasks</h2>
                {item?.subtasks.length ? (
                  <div className="mt-3 grid gap-2">
                    {item.subtasks.map((subtask) => (
                      <Link
                        key={subtask.key}
                        to="/jira/$workItemKey"
                        params={{ workItemKey: subtask.key }}
                        search={search}
                        className="rounded-lg border p-3 text-sm hover:bg-accent/50"
                      >
                        <span className="font-mono text-xs text-muted-foreground">
                          {subtask.key}
                        </span>
                        <span className="ml-2 font-medium">{subtask.summary}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {subtask.status ?? "—"}
                        </span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">No subtasks.</p>
                )}
              </div>
              <div>
                <h2 className="text-sm font-semibold">Related work</h2>
                {item?.relatedWorkItems.length ? (
                  <div className="mt-3 grid gap-2">
                    {item.relatedWorkItems.map((related) => (
                      <Link
                        key={related.key}
                        to="/jira/$workItemKey"
                        params={{ workItemKey: related.key }}
                        search={search}
                        className="rounded-lg border p-3 text-sm hover:bg-accent/50"
                      >
                        <span className="font-mono text-xs text-muted-foreground">
                          {related.key}
                        </span>
                        <span className="ml-2 font-medium">{related.summary}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {related.relationship ?? related.status ?? "Related"}
                        </span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">No related work items.</p>
                )}
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
            </aside>
          </div>
        </main>
      </div>
    </SidebarInset>
  );
}
