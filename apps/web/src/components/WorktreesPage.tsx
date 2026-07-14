import { normalizeWorktreePath } from "@t3tools/shared/worktreePath";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  FolderGit2Icon,
  GitBranchIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useArchivedThreadSnapshots } from "../lib/archivedThreadsState";
import { cn } from "../lib/utils";
import { useEnvironments } from "../state/environments";
import { useProjects, useThreadShells } from "../state/entities";
import { useAtomCommand } from "../state/use-atom-command";
import { vcsEnvironment } from "../state/vcs";
import { useEnvironmentQuery } from "../state/query";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { toastManager, stackedThreadToast } from "./ui/toast";
import { SidebarInset } from "./ui/sidebar";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";

type ThreadItem = {
  readonly id: string;
  readonly environmentId: string;
  readonly projectId: string;
  readonly title: string;
  readonly worktreePath: string | null;
  readonly archivedAt: string | null;
  readonly isRunning: boolean;
};

type ProjectItem = {
  readonly id: string;
  readonly environmentId: string;
  readonly title: string;
  readonly workspaceRoot: string;
};

function threadStatus(thread: ThreadItem): string {
  if (thread.isRunning) return "Em execução";
  return thread.archivedAt ? "Arquivada" : "Ativa";
}

function shortPath(path: string): string {
  const parts = path.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  return parts.at(-1) || path;
}

export function WorktreesPage() {
  const { environments } = useEnvironments();
  const liveProjects = useProjects();
  const liveThreads = useThreadShells();
  const environmentIds = useMemo(
    () => environments.map((environment) => environment.environmentId),
    [environments],
  );
  const { snapshots: archivedSnapshots, refresh: refreshArchived } =
    useArchivedThreadSnapshots(environmentIds);
  const [environmentFilter, setEnvironmentFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const projects = useMemo(() => {
    const entries = new Map<string, ProjectItem>();
    for (const project of liveProjects) {
      entries.set(`${project.environmentId}:${project.id}`, project);
    }
    for (const { environmentId, snapshot } of archivedSnapshots) {
      for (const project of snapshot.projects) {
        entries.set(`${environmentId}:${project.id}`, { ...project, environmentId });
      }
    }
    return [...entries.values()]
      .filter((project) => !environmentFilter || project.environmentId === environmentFilter)
      .toSorted(
        (left, right) =>
          left.title.localeCompare(right.title) ||
          left.workspaceRoot.localeCompare(right.workspaceRoot),
      );
  }, [archivedSnapshots, environmentFilter, liveProjects]);

  const threads = useMemo(() => {
    const entries = new Map<string, ThreadItem>();
    for (const thread of liveThreads) {
      entries.set(`${thread.environmentId}:${thread.id}`, {
        ...thread,
        isRunning: thread.session?.status === "running" && thread.session.activeTurnId !== null,
      });
    }
    for (const { environmentId, snapshot } of archivedSnapshots) {
      for (const thread of snapshot.threads) {
        entries.set(`${environmentId}:${thread.id}`, {
          ...thread,
          environmentId,
          isRunning: false,
        });
      }
    }
    return [...entries.values()];
  }, [archivedSnapshots, liveThreads]);

  const updateCount = useCallback((key: string, count: number) => {
    setCounts((previous) => (previous[key] === count ? previous : { ...previous, [key]: count }));
  }, []);
  useEffect(() => {
    setCounts({});
  }, [environmentFilter]);
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-6 wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]">
          <FolderGit2Icon className="size-5 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold">Worktrees</h1>
            <p className="text-xs text-muted-foreground">
              {total} {total === 1 ? "worktree encontrada" : "worktrees encontradas"}
            </p>
          </div>
          <select
            aria-label="Filtrar ambiente"
            className="h-8 max-w-48 rounded-md border border-input bg-background px-2 text-xs"
            value={environmentFilter}
            onChange={(event) => setEnvironmentFilter(event.target.value)}
          >
            <option value="">Todos os ambientes</option>
            {environments.map((environment) => (
              <option key={environment.environmentId} value={environment.environmentId}>
                {environment.label ?? environment.environmentId}
              </option>
            ))}
          </select>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              refreshArchived();
              setRefreshNonce((value) => value + 1);
            }}
          >
            <RefreshCwIcon className="size-3.5" /> Atualizar
          </Button>
        </header>
        <div className="shrink-0 border-b border-border px-4 py-3 sm:px-6">
          <Input
            aria-label="Buscar worktrees"
            placeholder="Buscar por branch, caminho, projeto ou thread..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
          {projects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              Nenhum projeto disponível neste ambiente.
            </div>
          ) : (
            <div className="space-y-6">
              {projects.map((project) => (
                <ProjectWorktrees
                  key={`${project.environmentId}:${project.id}`}
                  project={project}
                  threads={threads.filter(
                    (thread) =>
                      thread.environmentId === project.environmentId &&
                      thread.projectId === project.id,
                  )}
                  search={search}
                  refreshNonce={refreshNonce}
                  onCountChange={updateCount}
                />
              ))}
            </div>
          )}
        </main>
      </div>
    </SidebarInset>
  );
}

function ProjectWorktrees({
  project,
  threads,
  search,
  refreshNonce,
  onCountChange,
}: {
  readonly project: ProjectItem;
  readonly threads: ReadonlyArray<ThreadItem>;
  readonly search: string;
  readonly refreshNonce: number;
  readonly onCountChange: (key: string, count: number) => void;
}) {
  const query = useEnvironmentQuery(
    vcsEnvironment.listWorktrees({
      environmentId: project.environmentId as never,
      input: { cwd: project.workspaceRoot },
    }),
  );
  const [pending, setPending] = useState<{
    path: string;
    refName: string | null;
    threads: ReadonlyArray<ThreadItem>;
  } | null>(null);
  const key = `${project.environmentId}:${project.id}`;

  useEffect(() => {
    if (refreshNonce > 0) query.refresh();
  }, [query, refreshNonce]);

  const cards = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return (query.data?.worktrees ?? [])
      .filter((worktree) => !worktree.isMain)
      .map((worktree) => ({
        ...worktree,
        threads: threads.filter(
          (thread) =>
            normalizeWorktreePath(thread.worktreePath) === normalizeWorktreePath(worktree.path),
        ),
      }))
      .filter((worktree) => {
        if (!normalizedSearch) return true;
        return [
          worktree.refName ?? "HEAD destacado",
          worktree.path,
          project.title,
          ...worktree.threads.map((thread) => thread.title),
        ].some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
      })
      .toSorted((left, right) =>
        (left.refName ?? left.path).localeCompare(right.refName ?? right.path),
      );
  }, [project.title, query.data?.worktrees, search, threads]);

  useEffect(() => onCountChange(key, cards.length), [cards.length, key, onCountChange]);

  if (query.error) {
    return (
      <section className="rounded-xl border border-destructive/30 p-4">
        <h2 className="text-sm font-medium">{project.title}</h2>
        <p className="mt-1 text-xs text-destructive">
          Não foi possível carregar as worktrees deste projeto.
        </p>
      </section>
    );
  }
  if (!query.isPending && cards.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <GitBranchIcon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">{project.title}</h2>
        <span className="truncate text-xs text-muted-foreground">{project.workspaceRoot}</span>
      </div>
      {query.isPending ? (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">
          <LoaderCircleIcon className="size-3.5 animate-spin" /> Carregando worktrees…
        </div>
      ) : (
        <div className="grid gap-2">
          {cards.map((worktree) => (
            <WorktreeCard key={worktree.path} worktree={worktree} onDelete={setPending} />
          ))}
        </div>
      )}
      <DeleteWorktreeDialog
        project={project}
        pending={pending}
        onOpenChange={(open) => !open && setPending(null)}
        onDeleted={() => {
          setPending(null);
          query.refresh();
        }}
      />
    </section>
  );
}

function WorktreeCard({
  worktree,
  onDelete,
}: {
  readonly worktree: {
    path: string;
    refName: string | null;
    isDetached: boolean;
    threads: ReadonlyArray<ThreadItem>;
  };
  readonly onDelete: (value: {
    path: string;
    refName: string | null;
    threads: ReadonlyArray<ThreadItem>;
  }) => void;
}) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const running = worktree.threads.some((thread) => thread.isRunning);
  return (
    <article className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-start gap-3">
        <GitBranchIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs font-medium">
            {worktree.refName ?? "HEAD destacado"}
          </p>
          <div className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <span className="truncate" title={worktree.path}>
              {shortPath(worktree.path)}
            </span>
            <button
              className="shrink-0 rounded p-0.5 hover:bg-accent"
              aria-label="Copiar caminho"
              onClick={() => void navigator.clipboard?.writeText(worktree.path)}
            >
              <CopyIcon className="size-3" />
            </button>
          </div>
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          className="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label="Excluir worktree"
          title="Excluir worktree"
          onClick={() => onDelete(worktree)}
        >
          <Trash2Icon className="size-3.5" />
        </Button>
      </div>
      <div className="mt-3 border-t border-border pt-2">
        <button
          type="button"
          className="flex w-full items-center gap-1 text-left text-xs text-muted-foreground"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? (
            <ChevronDownIcon className="size-3.5" />
          ) : (
            <ChevronRightIcon className="size-3.5" />
          )}
          {worktree.threads.length}{" "}
          {worktree.threads.length === 1 ? "thread vinculada" : "threads vinculadas"}
          {running ? <span className="ml-1 text-amber-600">• uma em execução</span> : null}
        </button>
        {expanded ? (
          <div className="mt-2 space-y-1">
            {worktree.threads.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma thread usa esta worktree.</p>
            ) : (
              worktree.threads.map((thread) => (
                <button
                  key={`${thread.environmentId}:${thread.id}`}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
                  onClick={() =>
                    void navigate({
                      to: "/$environmentId/$threadId",
                      params: { environmentId: thread.environmentId, threadId: thread.id },
                    })
                  }
                >
                  <span className="truncate text-xs">{thread.title}</span>
                  <span
                    className={cn(
                      "shrink-0 text-[10px]",
                      thread.isRunning ? "text-amber-600" : "text-muted-foreground",
                    )}
                  >
                    {threadStatus(thread)}
                  </span>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function DeleteWorktreeDialog({
  project,
  pending,
  onOpenChange,
  onDeleted,
}: {
  readonly project: ProjectItem;
  readonly pending: {
    path: string;
    refName: string | null;
    threads: ReadonlyArray<ThreadItem>;
  } | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onDeleted: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const deleteWorktreeWithThreads = useAtomCommand(vcsEnvironment.deleteWorktreeWithThreads, {
    reportFailure: false,
  });
  const running = pending?.threads.filter((thread) => thread.isRunning) ?? [];
  const canDelete = pending !== null && running.length === 0 && confirmation === "EXCLUIR";
  useEffect(() => setConfirmation(""), [pending]);
  const confirm = async () => {
    if (!pending || !canDelete) return;
    const result = await deleteWorktreeWithThreads({
      environmentId: project.environmentId as never,
      input: { cwd: project.workspaceRoot, projectId: project.id as never, path: pending.path },
    });
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Não foi possível excluir a worktree",
          description: error instanceof Error ? error.message : "Tente novamente.",
        }),
      );
      return;
    }
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title: "Worktree excluída",
        description: `${pending.threads.length} thread(s) também foram excluídas.`,
      }),
    );
    onDeleted();
  };
  return (
    <AlertDialog open={pending !== null} onOpenChange={onOpenChange}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir worktree e threads?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta ação remove{" "}
            <span className="font-mono">{pending?.refName ?? "HEAD destacado"}</span>, apaga
            alterações locais não commitadas e exclui {pending?.threads.length ?? 0} thread(s)
            vinculadas.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3 px-6 pb-4 text-sm">
          <p className="break-all rounded-md bg-muted p-2 font-mono text-xs">{pending?.path}</p>
          {running.length > 0 ? (
            <p className="text-destructive">
              Interrompa as threads em execução antes de continuar:{" "}
              {running.map((thread) => thread.title).join(", ")}.
            </p>
          ) : (
            <>
              <label className="block text-xs text-muted-foreground">
                Digite <span className="font-mono font-medium text-foreground">EXCLUIR</span> para
                confirmar.
              </label>
              <Input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
              />
            </>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" size="sm" />}>
            Cancelar
          </AlertDialogClose>
          <Button
            size="sm"
            variant="destructive"
            disabled={!canDelete}
            onClick={() => void confirm()}
          >
            Excluir worktree e {pending?.threads.length ?? 0} threads
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
