import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";
import {
  EllipsisVerticalIcon,
  FolderIcon,
  GripVerticalIcon,
  MessageSquareIcon,
  Trash2Icon,
} from "lucide-react";

import type { KanbanCard as KanbanCardModel } from "../../kanban.logic";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

export const kanbanCardDndId = (cardId: string) => `kanban-card:${cardId}`;

export function KanbanCard({
  card,
  onOpen,
  onDelete,
  onStartThread,
  canStartThread,
}: {
  readonly card: KanbanCardModel;
  readonly onOpen: (card: KanbanCardModel) => void;
  readonly onDelete: (card: KanbanCardModel) => void;
  readonly onStartThread: (card: KanbanCardModel) => void;
  readonly canStartThread: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: kanbanCardDndId(card.id),
  });

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group rounded-xl border border-border bg-card p-3 shadow-xs",
        isDragging && "opacity-35",
      )}
      {...attributes}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label={`Drag ${card.title}`}
          className="mt-0.5 shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
          {...listeners}
        >
          <GripVerticalIcon className="size-3.5" />
        </button>
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => onOpen(card)}
          aria-label={`Open task ${card.title}`}
        >
          <h3 className="truncate text-sm font-medium">{card.title}</h3>
          <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
            {card.description}
          </p>
          {(card.projectLinks.length > 0 || card.threadLinks.length > 0) && (
            <div className="mt-3 flex flex-wrap gap-1">
              {card.projectLinks.map((link) => (
                <Badge key={`${link.environmentId}:${link.projectId}`} size="sm" variant="outline">
                  <FolderIcon className="size-2.5" />
                  <span className="max-w-32 truncate">{link.label}</span>
                </Badge>
              ))}
              {card.threadLinks.map((link) => (
                <Badge key={`${link.environmentId}:${link.threadId}`} size="sm" variant="outline">
                  <MessageSquareIcon className="size-2.5" />
                  <span className="max-w-32 truncate">{link.label}</span>
                </Badge>
              ))}
            </div>
          )}
        </button>
        <KanbanCardMenu
          card={card}
          canStartThread={canStartThread}
          onDelete={onDelete}
          onStartThread={onStartThread}
        />
      </div>
    </article>
  );
}

function KanbanCardMenu({
  card,
  canStartThread,
  onDelete,
  onStartThread,
}: {
  readonly card: KanbanCardModel;
  readonly canStartThread: boolean;
  readonly onDelete: (card: KanbanCardModel) => void;
  readonly onStartThread: (card: KanbanCardModel) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <>
      <Menu>
        <MenuTrigger
          aria-label={`Open actions for ${card.title}`}
          render={<Button size="icon-xs" variant="ghost" className="shrink-0" />}
        >
          <EllipsisVerticalIcon />
        </MenuTrigger>
        <MenuPopup align="end" className="w-44">
          <MenuItem
            disabled={!canStartThread}
            onClick={() => onStartThread(card)}
            title={canStartThread ? undefined : "Associate an available project to start a thread."}
          >
            <MessageSquareIcon />
            Start thread
          </MenuItem>
          <MenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2Icon />
            Delete
          </MenuItem>
        </MenuPopup>
      </Menu>
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
                onDelete(card);
                setConfirmDelete(false);
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

export function KanbanCardPreview({ card }: { readonly card: KanbanCardModel }) {
  return (
    <article className="w-70 rotate-1 rounded-xl border border-border bg-card p-3 shadow-lg">
      <h3 className="truncate text-sm font-medium">{card.title}</h3>
      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{card.description}</p>
    </article>
  );
}
