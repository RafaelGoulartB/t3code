import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  cardsForColumn,
  DEFAULT_KANBAN_COLUMNS,
  type KanbanCard,
  type KanbanCardInput,
  type KanbanColumnEnabled,
  type KanbanColumnId,
  moveKanbanCard,
  nextCardStatus,
  normalizeCardInput,
  normalizePersistedColumns,
  normalizePersistedKanbanCards,
} from "./kanban.logic";
import { resolveStorage } from "./lib/storage";
import { randomUUID } from "./lib/utils";

export const KANBAN_STORAGE_KEY = "t3code:kanban:v1";

export type KanbanSetColumnResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "not-empty"; readonly cardCount: number }
  | { readonly ok: false; readonly reason: "last-enabled" };

interface KanbanStoreState {
  readonly cards: readonly KanbanCard[];
  readonly columns: KanbanColumnEnabled;
  readonly createCard: (input: KanbanCardInput) => KanbanCard | null;
  readonly updateCardDetails: (cardId: string, input: KanbanCardInput) => boolean;
  readonly deleteCard: (cardId: string) => void;
  readonly moveCard: (
    cardId: string,
    destinationStatus: KanbanColumnId,
    destinationIndex: number,
  ) => void;
  readonly setColumnEnabled: (column: KanbanColumnId, enabled: boolean) => KanbanSetColumnResult;
}

function now(): string {
  return new Date().toISOString();
}

export const useKanbanStore = create<KanbanStoreState>()(
  persist(
    (set, get) => ({
      cards: [],
      columns: DEFAULT_KANBAN_COLUMNS,
      createCard: (input) => {
        const normalized = normalizeCardInput(input);
        if (!normalized) return null;
        const timestamp = now();
        const status = nextCardStatus(get().columns);
        const card: KanbanCard = {
          id: randomUUID(),
          ...normalized,
          status,
          order: cardsForColumn(get().cards, status).length,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        set((state) => ({ cards: [...state.cards, card] }));
        return card;
      },
      updateCardDetails: (cardId, input) => {
        const normalized = normalizeCardInput(input);
        if (!normalized) return false;
        const timestamp = now();
        let changed = false;
        set((state) => ({
          cards: state.cards.map((card) => {
            if (card.id !== cardId) return card;
            changed = true;
            return { ...card, ...normalized, updatedAt: timestamp };
          }),
        }));
        return changed;
      },
      deleteCard: (cardId) =>
        set((state) => ({ cards: state.cards.filter((card) => card.id !== cardId) })),
      moveCard: (cardId, destinationStatus, destinationIndex) =>
        set((state) => ({
          cards: moveKanbanCard({
            cards: state.cards,
            cardId,
            destinationStatus,
            destinationIndex,
            updatedAt: now(),
          }),
        })),
      setColumnEnabled: (column, enabled) => {
        const state = get();
        if (state.columns[column] === enabled) return { ok: true };
        if (enabled) {
          set((current) => ({ columns: { ...current.columns, [column]: true } }));
          return { ok: true };
        }
        const cardCount = cardsForColumn(state.cards, column).length;
        if (cardCount > 0) return { ok: false, reason: "not-empty", cardCount };
        if (Object.values(state.columns).filter(Boolean).length <= 1) {
          return { ok: false, reason: "last-enabled" };
        }
        set((current) => ({ columns: { ...current.columns, [column]: false } }));
        return { ok: true };
      },
    }),
    {
      name: KANBAN_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ cards: state.cards, columns: state.columns }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as { cards?: unknown; columns?: unknown } | undefined;
        return {
          ...currentState,
          cards: normalizePersistedKanbanCards(persisted?.cards),
          columns: normalizePersistedColumns(persisted?.columns),
        };
      },
    },
  ),
);
