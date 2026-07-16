import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useMemo, useState } from "react";

import {
  cardsForColumn,
  KANBAN_COLUMN_IDS,
  KANBAN_COLUMN_LABELS,
  type KanbanCard as KanbanCardModel,
  type KanbanColumnEnabled,
  type KanbanColumnId,
} from "../../kanban.logic";
import { KanbanCardPreview } from "./KanbanCard";
import { KanbanColumn } from "./KanbanColumn";

function cardIdFromDndId(id: string | number): string | null {
  const value = String(id);
  return value.startsWith("kanban-card:") ? value.slice("kanban-card:".length) : null;
}

function columnIdFromDndId(id: string | number): KanbanColumnId | null {
  const value = String(id);
  const column = value.startsWith("kanban-column:") ? value.slice("kanban-column:".length) : null;
  return column && KANBAN_COLUMN_IDS.includes(column as KanbanColumnId)
    ? (column as KanbanColumnId)
    : null;
}

export function KanbanBoard({
  cards,
  columns,
  onMoveCard,
  onOpenCard,
  onDeleteCard,
  onStartThread,
  canStartThread,
}: {
  readonly cards: readonly KanbanCardModel[];
  readonly columns: KanbanColumnEnabled;
  readonly onMoveCard: (cardId: string, destination: KanbanColumnId, index: number) => void;
  readonly onOpenCard: (card: KanbanCardModel) => void;
  readonly onDeleteCard: (card: KanbanCardModel) => void;
  readonly onStartThread: (card: KanbanCardModel) => void;
  readonly canStartThread: (card: KanbanCardModel) => boolean;
}) {
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const activeCard = useMemo(
    () => cards.find((card) => card.id === activeCardId) ?? null,
    [activeCardId, cards],
  );

  const handleDragStart = ({ active }: DragStartEvent) =>
    setActiveCardId(cardIdFromDndId(active.id));
  const handleDragCancel = () => setActiveCardId(null);
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveCardId(null);
    const cardId = cardIdFromDndId(active.id);
    if (!cardId || !over) return;

    const overCardId = cardIdFromDndId(over.id);
    const targetCard = overCardId ? cards.find((card) => card.id === overCardId) : null;
    const destination = targetCard?.status ?? columnIdFromDndId(over.id);
    if (!destination || !columns[destination]) return;
    const destinationCards = cardsForColumn(
      cards.filter((card) => card.id !== cardId),
      destination,
    );
    const index = targetCard
      ? destinationCards.findIndex((card) => card.id === targetCard.id)
      : destinationCards.length;
    onMoveCard(cardId, destination, index < 0 ? destinationCards.length : index);
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
    >
      <div className="flex min-h-0 min-w-max flex-1 gap-3 overflow-x-auto p-4 sm:gap-4 sm:p-6">
        {KANBAN_COLUMN_IDS.filter((column) => columns[column]).map((column) => (
          <KanbanColumn
            key={column}
            column={column}
            label={KANBAN_COLUMN_LABELS[column]}
            cards={cardsForColumn(cards, column)}
            onOpenCard={onOpenCard}
            onDeleteCard={onDeleteCard}
            onStartThread={onStartThread}
            canStartThread={canStartThread}
          />
        ))}
      </div>
      <DragOverlay>{activeCard ? <KanbanCardPreview card={activeCard} /> : null}</DragOverlay>
    </DndContext>
  );
}
