import { useState } from "react";

import {
  cardsForColumn,
  KANBAN_COLUMN_IDS,
  KANBAN_COLUMN_LABELS,
  type KanbanCard,
  type KanbanColumnEnabled,
} from "../../kanban.logic";
import type { KanbanSetColumnResult } from "../../kanbanStore";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";

export function KanbanColumnSettingsDialog({
  open,
  onOpenChange,
  cards,
  columns,
  onSetColumnEnabled,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly cards: readonly KanbanCard[];
  readonly columns: KanbanColumnEnabled;
  readonly onSetColumnEnabled: (
    column: (typeof KANBAN_COLUMN_IDS)[number],
    enabled: boolean,
  ) => KanbanSetColumnResult;
}) {
  const [error, setError] = useState<string | null>(null);

  const changeColumn = (column: (typeof KANBAN_COLUMN_IDS)[number], enabled: boolean) => {
    const result = onSetColumnEnabled(column, enabled);
    if (result.ok) {
      setError(null);
      return;
    }
    setError(
      result.reason === "not-empty"
        ? `Move the ${result.cardCount} ${result.cardCount === 1 ? "card" : "cards"} before disabling this column.`
        : "Keep at least one column enabled.",
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage columns</DialogTitle>
          <DialogDescription>Disable only the stages you do not need.</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-2">
          {KANBAN_COLUMN_IDS.map((column) => {
            const count = cardsForColumn(cards, column).length;
            return (
              <label
                key={column}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border p-3 hover:bg-accent/40"
              >
                <span>
                  <span className="block text-sm font-medium">{KANBAN_COLUMN_LABELS[column]}</span>
                  <span className="text-xs text-muted-foreground">
                    {count} {count === 1 ? "card" : "cards"}
                  </span>
                </span>
                <Switch
                  checked={columns[column]}
                  onCheckedChange={(checked) => changeColumn(column, checked)}
                  aria-label={`Enable ${KANBAN_COLUMN_LABELS[column]} column`}
                />
              </label>
            );
          })}
          {error ? <p className="pt-1 text-xs text-destructive">{error}</p> : null}
        </DialogPanel>
        <DialogFooter>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
