import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

import type { KanbanCard as KanbanCardModel, KanbanColumnId } from "../../kanban.logic";
import { cn } from "../../lib/utils";
import { KanbanCard, kanbanCardDndId } from "./KanbanCard";

export const kanbanColumnDndId = (column: KanbanColumnId) => `kanban-column:${column}`;

export function KanbanColumn({
  column,
  label,
  cards,
  onOpenCard,
  onDeleteCard,
  onStartThread,
  canStartThread,
}: {
  readonly column: KanbanColumnId;
  readonly label: string;
  readonly cards: readonly KanbanCardModel[];
  readonly onOpenCard: (card: KanbanCardModel) => void;
  readonly onDeleteCard: (card: KanbanCardModel) => void;
  readonly onStartThread: (card: KanbanCardModel) => void;
  readonly canStartThread: (card: KanbanCardModel) => boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: kanbanColumnDndId(column) });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex min-h-72 min-w-70 flex-1 flex-col rounded-2xl border border-border bg-muted/28 p-2.5 transition-colors",
        isOver && "border-primary/60 bg-primary/5",
      )}
    >
      <header className="flex items-center justify-between gap-2 px-1 pb-2">
        <h2 className="text-sm font-semibold">{label}</h2>
        <span className="rounded-md bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {cards.length}
        </span>
      </header>
      <SortableContext
        items={cards.map((card) => kanbanCardDndId(card.id))}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex min-h-16 flex-1 flex-col gap-2">
          {cards.map((card) => (
            <KanbanCard
              key={card.id}
              card={card}
              onOpen={onOpenCard}
              onDelete={onDeleteCard}
              onStartThread={onStartThread}
              canStartThread={canStartThread(card)}
            />
          ))}
          {cards.length === 0 && (
            <p className="flex min-h-20 items-center justify-center rounded-xl border border-dashed border-border px-3 text-center text-xs text-muted-foreground">
              Drop a task here
            </p>
          )}
        </div>
      </SortableContext>
    </section>
  );
}
