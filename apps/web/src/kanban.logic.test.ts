import { describe, expect, it } from "vite-plus/test";

import {
  cardsForColumn,
  DEFAULT_KANBAN_COLUMNS,
  moveKanbanCard,
  nextCardStatus,
  normalizeCardInput,
  normalizePersistedColumns,
  normalizePersistedKanbanCards,
} from "./kanban.logic";

const card = (id: string, status: "plan" | "todo" | "doing" | "done", order: number) => ({
  id,
  title: `Task ${id}`,
  description: `Description ${id}`,
  status,
  order,
  projectLinks: [],
  threadLinks: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("kanban logic", () => {
  it("requires a title and description and deduplicates associations", () => {
    expect(
      normalizeCardInput({
        title: " ",
        description: "Description",
        projectLinks: [],
        threadLinks: [],
      }),
    ).toBeNull();
    const input = normalizeCardInput({
      title: "  Task  ",
      description: "  Description  ",
      projectLinks: [
        {
          environmentId: "env",
          projectId: "project",
          label: "Project",
          workspaceRoot: "C:/project",
        },
        {
          environmentId: "env",
          projectId: "project",
          label: "Old name",
          workspaceRoot: "C:/project",
        },
      ],
      threadLinks: [
        { environmentId: "env", threadId: "thread", projectId: "project", label: "Thread" },
        { environmentId: "env", threadId: "thread", projectId: "project", label: "Old thread" },
      ],
    });
    expect(input).toMatchObject({ title: "Task", description: "Description" });
    expect(input?.projectLinks).toHaveLength(1);
    expect(input?.threadLinks).toHaveLength(1);
  });

  it("moves a card across columns and normalizes both orders", () => {
    const result = moveKanbanCard({
      cards: [card("a", "todo", 0), card("b", "todo", 1), card("c", "doing", 0)],
      cardId: "a",
      destinationStatus: "doing",
      destinationIndex: 1,
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(cardsForColumn(result, "todo").map((entry) => [entry.id, entry.order])).toEqual([
      ["b", 0],
    ]);
    expect(cardsForColumn(result, "doing").map((entry) => [entry.id, entry.order])).toEqual([
      ["c", 0],
      ["a", 1],
    ]);
    expect(result.find((entry) => entry.id === "a")?.updatedAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("falls back safely for malformed persisted data", () => {
    expect(normalizePersistedKanbanCards({ cards: [] })).toEqual([]);
    expect(
      normalizePersistedColumns({ plan: false, todo: false, doing: false, done: false }),
    ).toEqual(DEFAULT_KANBAN_COLUMNS);
    expect(normalizePersistedKanbanCards([card("valid", "todo", 0), { id: "bad" }])).toHaveLength(
      1,
    );
  });

  it("chooses Todo unless it is disabled", () => {
    expect(nextCardStatus(DEFAULT_KANBAN_COLUMNS)).toBe("todo");
    expect(nextCardStatus({ plan: true, todo: false, doing: true, done: true })).toBe("plan");
  });
});
