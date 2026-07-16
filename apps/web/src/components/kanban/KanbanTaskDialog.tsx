import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FolderIcon, MessageSquareIcon, XIcon } from "lucide-react";

import type {
  KanbanCard,
  KanbanCardInput,
  KanbanProjectLink,
  KanbanThreadLink,
} from "../../kanban.logic";
import { normalizeCardInput, uniqueProjectLinks, uniqueThreadLinks } from "../../kanban.logic";
import { useProjects, useThreadShells } from "../../state/entities";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

type Draft = KanbanCardInput;

const EMPTY_DRAFT: Draft = { title: "", description: "", projectLinks: [], threadLinks: [] };

function projectKey(link: Pick<KanbanProjectLink, "environmentId" | "projectId">): string {
  return `${link.environmentId}:${link.projectId}`;
}

function threadKey(link: Pick<KanbanThreadLink, "environmentId" | "threadId">): string {
  return `${link.environmentId}:${link.threadId}`;
}

export function KanbanTaskDialog({
  open,
  card,
  onOpenChange,
  onCreate,
  onUpdate,
  onDelete,
}: {
  readonly open: boolean;
  readonly card: KanbanCard | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate: (input: KanbanCardInput) => boolean;
  readonly onUpdate: (cardId: string, input: KanbanCardInput) => boolean;
  readonly onDelete: (cardId: string) => void;
}) {
  const projects = useProjects();
  const threads = useThreadShells();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [associationSearch, setAssociationSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(
      card
        ? {
            title: card.title,
            description: card.description,
            projectLinks: card.projectLinks,
            threadLinks: card.threadLinks,
          }
        : EMPTY_DRAFT,
    );
    setError(null);
    setAssociationSearch("");
    setConfirmDelete(false);
  }, [card, open]);

  const search = associationSearch.trim().toLocaleLowerCase();
  const visibleProjects = useMemo(
    () =>
      projects.filter((project) =>
        [project.title, project.workspaceRoot].some((value) =>
          value.toLocaleLowerCase().includes(search),
        ),
      ),
    [projects, search],
  );
  const visibleThreads = useMemo(
    () => threads.filter((thread) => thread.title.toLocaleLowerCase().includes(search)),
    [search, threads],
  );
  const selectedProjects = new Set(draft.projectLinks.map(projectKey));
  const selectedThreads = new Set(draft.threadLinks.map(threadKey));

  const toggleProject = (link: KanbanProjectLink) => {
    const key = projectKey(link);
    setDraft((current) => ({
      ...current,
      projectLinks: current.projectLinks.some((candidate) => projectKey(candidate) === key)
        ? current.projectLinks.filter((candidate) => projectKey(candidate) !== key)
        : uniqueProjectLinks([...current.projectLinks, link]),
    }));
  };
  const toggleThread = (link: KanbanThreadLink) => {
    const key = threadKey(link);
    setDraft((current) => ({
      ...current,
      threadLinks: current.threadLinks.some((candidate) => threadKey(candidate) === key)
        ? current.threadLinks.filter((candidate) => threadKey(candidate) !== key)
        : uniqueThreadLinks([...current.threadLinks, link]),
    }));
  };
  const save = () => {
    const normalized = normalizeCardInput(draft);
    if (!normalized) {
      setError("Title and description are required.");
      return;
    }
    const saved = card ? onUpdate(card.id, normalized) : onCreate(normalized);
    if (saved) onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogPopup className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{card ? "Task details" : "New task"}</DialogTitle>
            <DialogDescription>
              Change the status only by dragging the card on the board.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-xs font-medium" htmlFor="kanban-card-title">
                Title
              </label>
              <Input
                id="kanban-card-title"
                value={draft.title}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, title: event.target.value }))
                }
                placeholder="Describe the task"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium" htmlFor="kanban-card-description">
                Description
              </label>
              <Textarea
                id="kanban-card-description"
                value={draft.description}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, description: event.target.value }))
                }
                placeholder="Add the context needed to complete this task"
              />
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-medium">Associations</h3>
                  <p className="text-xs text-muted-foreground">
                    Projects and threads are stored only on this card.
                  </p>
                </div>
                <Input
                  className="w-52"
                  value={associationSearch}
                  onChange={(event) => setAssociationSearch(event.target.value)}
                  placeholder="Search associations"
                />
              </div>
              {(draft.projectLinks.length > 0 || draft.threadLinks.length > 0) && (
                <div className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-muted/30 p-2">
                  {draft.projectLinks.map((link) => (
                    <button
                      key={projectKey(link)}
                      type="button"
                      onClick={() => toggleProject(link)}
                    >
                      <Badge variant="outline">
                        <FolderIcon />
                        {link.label}
                        <XIcon />
                      </Badge>
                    </button>
                  ))}
                  {draft.threadLinks.map((link) => (
                    <button key={threadKey(link)} type="button" onClick={() => toggleThread(link)}>
                      <Badge variant="outline">
                        <MessageSquareIcon />
                        {link.label}
                        <XIcon />
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <AssociationList title="Projects" icon={<FolderIcon className="size-3.5" />}>
                  {visibleProjects.map((project) => {
                    const link: KanbanProjectLink = {
                      environmentId: String(project.environmentId),
                      projectId: String(project.id),
                      label: project.title,
                      workspaceRoot: project.workspaceRoot,
                    };
                    return (
                      <AssociationOption
                        key={projectKey(link)}
                        checked={selectedProjects.has(projectKey(link))}
                        label={project.title}
                        detail={project.workspaceRoot}
                        onCheckedChange={() => toggleProject(link)}
                      />
                    );
                  })}
                </AssociationList>
                <AssociationList title="Threads" icon={<MessageSquareIcon className="size-3.5" />}>
                  {visibleThreads.map((thread) => {
                    const link: KanbanThreadLink = {
                      environmentId: String(thread.environmentId),
                      threadId: String(thread.id),
                      projectId: String(thread.projectId),
                      label: thread.title,
                    };
                    return (
                      <AssociationOption
                        key={threadKey(link)}
                        checked={selectedThreads.has(threadKey(link))}
                        label={thread.title}
                        onCheckedChange={() => toggleThread(link)}
                      />
                    );
                  })}
                </AssociationList>
              </div>
            </div>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </DialogPanel>
          <DialogFooter className={card ? "sm:justify-between" : undefined}>
            {card ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2 max-sm:flex-col-reverse">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={save}>
                {card ? "Save" : "Create task"}
              </Button>
            </div>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the card and its local associations.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (card) onDelete(card.id);
                setConfirmDelete(false);
                onOpenChange(false);
              }}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}

function AssociationList({
  title,
  icon,
  children,
}: {
  readonly title: string;
  readonly icon: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-border">
      <header className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-xs font-medium">
        {icon}
        {title}
      </header>
      <div className="max-h-44 space-y-0.5 overflow-auto p-1.5">
        {children || <p className="px-2 py-3 text-xs text-muted-foreground">No results.</p>}
      </div>
    </section>
  );
}

function AssociationOption({
  checked,
  label,
  detail,
  onCheckedChange,
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly detail?: string;
  readonly onCheckedChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-accent">
      <Checkbox checked={checked} onCheckedChange={onCheckedChange} />
      <span className="min-w-0">
        <span className="block truncate text-xs">{label}</span>
        {detail ? (
          <span className="block truncate text-[11px] text-muted-foreground">{detail}</span>
        ) : null}
      </span>
    </label>
  );
}
