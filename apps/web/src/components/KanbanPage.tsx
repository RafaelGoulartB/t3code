import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { FolderIcon, KanbanSquareIcon, PlusIcon, SlidersHorizontalIcon } from "lucide-react";
import { useState } from "react";

import type { KanbanCard, KanbanCardInput, KanbanProjectLink } from "../kanban.logic";
import { useKanbanStore } from "../kanbanStore";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useProjects } from "../state/entities";
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
import { SidebarInset } from "./ui/sidebar";
import { KanbanBoard } from "./kanban/KanbanBoard";
import { KanbanColumnSettingsDialog } from "./kanban/KanbanColumnSettingsDialog";
import { KanbanTaskDialog } from "./kanban/KanbanTaskDialog";

export function KanbanPage() {
  const cards = useKanbanStore((state) => state.cards);
  const columns = useKanbanStore((state) => state.columns);
  const createCard = useKanbanStore((state) => state.createCard);
  const updateCardDetails = useKanbanStore((state) => state.updateCardDetails);
  const deleteCard = useKanbanStore((state) => state.deleteCard);
  const moveCard = useKanbanStore((state) => state.moveCard);
  const setColumnEnabled = useKanbanStore((state) => state.setColumnEnabled);
  const projects = useProjects();
  const startNewThread = useNewThreadHandler();
  const [editingCard, setEditingCard] = useState<KanbanCard | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectPickerCard, setProjectPickerCard] = useState<KanbanCard | null>(null);

  const openNewCard = () => {
    setEditingCard(null);
    setTaskDialogOpen(true);
  };
  const openCard = (card: KanbanCard) => {
    setEditingCard(card);
    setTaskDialogOpen(true);
  };
  const create = (input: KanbanCardInput) => createCard(input) !== null;
  const isAvailableProject = (link: KanbanProjectLink) =>
    projects.some(
      (project) =>
        String(project.environmentId) === link.environmentId &&
        String(project.id) === link.projectId,
    );
  const availableProjectsFor = (card: KanbanCard) =>
    card.projectLinks.filter((link) => isAvailableProject(link));
  const startThreadForProject = (card: KanbanCard, project: KanbanProjectLink) => {
    setProjectPickerCard(null);
    void startNewThread(
      scopeProjectRef(project.environmentId as EnvironmentId, project.projectId as ProjectId),
      { initialPrompt: `${card.title}\n\n${card.description}` },
    );
  };
  const startThread = (card: KanbanCard) => {
    const availableProjects = availableProjectsFor(card);
    if (availableProjects.length === 1) {
      startThreadForProject(card, availableProjects[0]!);
      return;
    }
    if (availableProjects.length > 1) {
      setProjectPickerCard(card);
    }
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-6 wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]">
          <KanbanSquareIcon className="size-5 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold">Kanban</h1>
            <p className="text-xs text-muted-foreground">
              Organize tasks without changing projects or threads.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>
            <SlidersHorizontalIcon />
            Manage columns
          </Button>
          <Button size="sm" onClick={openNewCard}>
            <PlusIcon />
            New task
          </Button>
        </header>
        <KanbanBoard
          cards={cards}
          columns={columns}
          onMoveCard={moveCard}
          onOpenCard={openCard}
          onDeleteCard={(card) => deleteCard(card.id)}
          onStartThread={startThread}
          canStartThread={(card) => availableProjectsFor(card).length > 0}
        />
      </div>
      <KanbanTaskDialog
        open={taskDialogOpen}
        card={editingCard}
        onOpenChange={setTaskDialogOpen}
        onCreate={create}
        onUpdate={updateCardDetails}
        onDelete={deleteCard}
      />
      <KanbanColumnSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        cards={cards}
        columns={columns}
        onSetColumnEnabled={setColumnEnabled}
      />
      <ProjectPickerDialog
        card={projectPickerCard}
        onOpenChange={(open) => !open && setProjectPickerCard(null)}
        onSelect={startThreadForProject}
        projects={projectPickerCard ? availableProjectsFor(projectPickerCard) : []}
      />
    </SidebarInset>
  );
}

function ProjectPickerDialog({
  card,
  projects,
  onOpenChange,
  onSelect,
}: {
  readonly card: KanbanCard | null;
  readonly projects: readonly KanbanProjectLink[];
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (card: KanbanCard, project: KanbanProjectLink) => void;
}) {
  return (
    <Dialog open={card !== null} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose a project</DialogTitle>
          <DialogDescription>
            This task is associated with multiple projects. Select where to start the thread.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-2">
          {projects.map((project) => (
            <Button
              key={`${project.environmentId}:${project.projectId}`}
              variant="outline"
              className="h-auto w-full justify-start gap-3 px-3 py-2.5 text-left"
              onClick={() => card && onSelect(card, project)}
            >
              <FolderIcon className="size-4 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate">{project.label}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {project.workspaceRoot}
                </span>
              </span>
            </Button>
          ))}
        </DialogPanel>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
