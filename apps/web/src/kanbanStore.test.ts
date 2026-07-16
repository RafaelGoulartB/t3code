import { beforeEach, describe, expect, it } from "vite-plus/test";

import { DEFAULT_KANBAN_COLUMNS } from "./kanban.logic";
import { useKanbanStore } from "./kanbanStore";

const input = {
  title: "Task",
  description: "Description",
  projectLinks: [],
  threadLinks: [],
};

describe("kanban store", () => {
  beforeEach(() => {
    useKanbanStore.setState({ cards: [], columns: { ...DEFAULT_KANBAN_COLUMNS } });
  });

  it("creates new cards in Todo and uses the first enabled column as a fallback", () => {
    const todoCard = useKanbanStore.getState().createCard(input);
    expect(todoCard?.status).toBe("todo");

    useKanbanStore.setState({
      cards: [],
      columns: { plan: false, todo: false, doing: true, done: true },
    });
    const fallbackCard = useKanbanStore.getState().createCard(input);
    expect(fallbackCard?.status).toBe("doing");
  });

  it("does not let a non-empty column or the last column be disabled", () => {
    useKanbanStore.getState().createCard(input);
    expect(useKanbanStore.getState().setColumnEnabled("todo", false)).toEqual({
      ok: false,
      reason: "not-empty",
      cardCount: 1,
    });

    useKanbanStore.setState({
      cards: [],
      columns: { plan: false, todo: false, doing: false, done: true },
    });
    expect(useKanbanStore.getState().setColumnEnabled("done", false)).toEqual({
      ok: false,
      reason: "last-enabled",
    });
  });
});
