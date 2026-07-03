import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { ProjectId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  migratePersistedTerminalUiStateStoreState,
  selectTerminalUiState,
  terminalUiScopeKey,
  useTerminalUiStateStore,
  type ScopedTerminalUiRef,
} from "./terminalUiStateStore";
import { DEFAULT_THREAD_TERMINAL_ID } from "./types";

const PROJECT_ID = ProjectId.make("project-1");
const TERMINAL_REF: ScopedTerminalUiRef = {
  ...scopeProjectRef("environment-a" as never, PROJECT_ID),
  worktreePath: null,
};
const OTHER_TERMINAL_REF: ScopedTerminalUiRef = {
  ...scopeProjectRef("environment-b" as never, PROJECT_ID),
  worktreePath: null,
};

describe("terminalUiStateStore actions", () => {
  beforeEach(() => {
    useTerminalUiStateStore.persist.clearStorage();
    useTerminalUiStateStore.setState({
      terminalUiStateByProjectKey: {},
      suppressedTerminalIdsByProjectKey: {},
    });
  });

  it("returns an empty default terminal UI state for unknown threads", () => {
    const terminalUiState = selectTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByProjectKey,
      TERMINAL_REF,
    );
    expect(terminalUiState).toEqual({
      terminalOpen: false,
      terminalHeight: 280,
      terminalIds: [],
      activeTerminalId: "",
      terminalGroups: [],
      activeTerminalGroupId: "",
    });
  });

  it("opens and splits terminals into the active group", () => {
    const store = useTerminalUiStateStore.getState();
    store.setTerminalOpen(TERMINAL_REF, true);
    store.splitTerminal(TERMINAL_REF, "terminal-2");

    const terminalUiState = selectTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByProjectKey,
      TERMINAL_REF,
    );
    expect(terminalUiState.terminalOpen).toBe(true);
    expect(terminalUiState.terminalIds).toEqual([DEFAULT_THREAD_TERMINAL_ID, "terminal-2"]);
    expect(terminalUiState.activeTerminalId).toBe("terminal-2");
    expect(terminalUiState.terminalGroups).toEqual([
      {
        id: `group-${DEFAULT_THREAD_TERMINAL_ID}`,
        terminalIds: [DEFAULT_THREAD_TERMINAL_ID, "terminal-2"],
      },
    ]);
  });

  it("stacks vertically split terminals in the active group", () => {
    const store = useTerminalUiStateStore.getState();
    store.setTerminalOpen(TERMINAL_REF, true);
    store.splitTerminalVertical(TERMINAL_REF, "terminal-2");

    const terminalUiState = selectTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByProjectKey,
      TERMINAL_REF,
    );
    expect(terminalUiState.terminalGroups).toEqual([
      {
        id: `group-${DEFAULT_THREAD_TERMINAL_ID}`,
        terminalIds: [DEFAULT_THREAD_TERMINAL_ID, "terminal-2"],
        splitDirection: "vertical",
      },
    ]);
  });

  it("materializes the default terminal when opening an empty drawer", () => {
    useTerminalUiStateStore.getState().setTerminalOpen(TERMINAL_REF, true);

    const terminalUiState = selectTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByProjectKey,
      TERMINAL_REF,
    );
    expect(terminalUiState).toEqual({
      terminalOpen: true,
      terminalHeight: 280,
      terminalIds: [DEFAULT_THREAD_TERMINAL_ID],
      activeTerminalId: DEFAULT_THREAD_TERMINAL_ID,
      terminalGroups: [
        {
          id: `group-${DEFAULT_THREAD_TERMINAL_ID}`,
          terminalIds: [DEFAULT_THREAD_TERMINAL_ID],
        },
      ],
      activeTerminalGroupId: `group-${DEFAULT_THREAD_TERMINAL_ID}`,
    });
  });

  it("caps splits at four terminals per group", () => {
    const store = useTerminalUiStateStore.getState();
    store.splitTerminal(TERMINAL_REF, "terminal-2");
    store.splitTerminal(TERMINAL_REF, "terminal-3");
    store.splitTerminal(TERMINAL_REF, "terminal-4");
    store.splitTerminal(TERMINAL_REF, "terminal-5");
    store.splitTerminal(TERMINAL_REF, "terminal-6");

    const terminalUiState = selectTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByProjectKey,
      TERMINAL_REF,
    );
    expect(terminalUiState.terminalIds).toEqual([
      "terminal-2",
      "terminal-3",
      "terminal-4",
      "terminal-5",
    ]);
    expect(terminalUiState.terminalGroups).toEqual([
      {
        id: "group-terminal-2",
        terminalIds: ["terminal-2", "terminal-3", "terminal-4", "terminal-5"],
      },
    ]);
  });

  it("creates new terminals in a separate group", () => {
    useTerminalUiStateStore.getState().newTerminal(TERMINAL_REF, "terminal-2");

    const terminalUiState = selectTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByProjectKey,
      TERMINAL_REF,
    );
    expect(terminalUiState.terminalIds).toEqual(["terminal-2"]);
    expect(terminalUiState.activeTerminalId).toBe("terminal-2");
    expect(terminalUiState.activeTerminalGroupId).toBe("group-terminal-2");
    expect(terminalUiState.terminalGroups).toEqual([
      { id: "group-terminal-2", terminalIds: ["terminal-2"] },
    ]);
  });

  it("ensures unknown server terminals are registered, opened, and activated", () => {
    const store = useTerminalUiStateStore.getState();
    store.ensureTerminal(TERMINAL_REF, "setup-setup", { open: true, active: true });

    const terminalUiState = selectTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByProjectKey,
      TERMINAL_REF,
    );
    expect(terminalUiState.terminalOpen).toBe(true);
    expect(terminalUiState.terminalIds).toEqual(["setup-setup"]);
    expect(terminalUiState.activeTerminalId).toBe("setup-setup");
    expect(terminalUiState.terminalGroups).toEqual([
      { id: "group-setup-setup", terminalIds: ["setup-setup"] },
    ]);
  });

  it("keeps state isolated per environment when raw thread ids collide", () => {
    const store = useTerminalUiStateStore.getState();
    store.setTerminalOpen(TERMINAL_REF, true);
    store.newTerminal(OTHER_TERMINAL_REF, "env-b-terminal");

    expect(
      selectTerminalUiState(
        useTerminalUiStateStore.getState().terminalUiStateByProjectKey,
        TERMINAL_REF,
      ).terminalOpen,
    ).toBe(true);
    expect(
      selectTerminalUiState(
        useTerminalUiStateStore.getState().terminalUiStateByProjectKey,
        OTHER_TERMINAL_REF,
      ).terminalIds,
    ).toEqual(["env-b-terminal"]);
  });

  it("drops persisted entries whose terminal scope keys are not valid scoped keys", () => {
    const migrated = migratePersistedTerminalUiStateStoreState(
      {
        terminalUiStateByProjectKey: {
          [terminalUiScopeKey(TERMINAL_REF)]: {
            terminalOpen: true,
            terminalHeight: 320,
            terminalIds: ["term-1"],
            activeTerminalId: "term-1",
            terminalGroups: [{ id: "group-term-1", terminalIds: ["term-1"] }],
            activeTerminalGroupId: "group-term-1",
          },
          "legacy-project-id": {
            terminalOpen: true,
            terminalHeight: 320,
            terminalIds: ["term-1"],
            activeTerminalId: "term-1",
            terminalGroups: [{ id: "group-term-1", terminalIds: ["term-1"] }],
            activeTerminalGroupId: "group-term-1",
          },
        },
      },
      2,
    );

    expect(migrated).toEqual({
      terminalUiStateByProjectKey: {
        [terminalUiScopeKey(TERMINAL_REF)]: {
          terminalOpen: true,
          terminalHeight: 320,
          terminalIds: ["term-1"],
          activeTerminalId: "term-1",
          terminalGroups: [{ id: "group-term-1", terminalIds: ["term-1"] }],
          activeTerminalGroupId: "group-term-1",
        },
      },
    });
  });

  it("resets to default and clears persisted entry when closing the last terminal", () => {
    const store = useTerminalUiStateStore.getState();
    store.newTerminal(TERMINAL_REF, "terminal-only");
    store.closeTerminal(TERMINAL_REF, "terminal-only");

    expect(
      useTerminalUiStateStore.getState().terminalUiStateByProjectKey[
        terminalUiScopeKey(TERMINAL_REF)
      ],
    ).toBeUndefined();
    expect(
      selectTerminalUiState(
        useTerminalUiStateStore.getState().terminalUiStateByProjectKey,
        TERMINAL_REF,
      ).terminalIds,
    ).toEqual([]);
  });

  it("keeps a valid active terminal after closing an active split terminal", () => {
    const store = useTerminalUiStateStore.getState();
    store.splitTerminal(TERMINAL_REF, "terminal-2");
    store.splitTerminal(TERMINAL_REF, "terminal-3");
    store.closeTerminal(TERMINAL_REF, "terminal-3");

    const terminalUiState = selectTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByProjectKey,
      TERMINAL_REF,
    );
    expect(terminalUiState.activeTerminalId).toBe("terminal-2");
    expect(terminalUiState.terminalIds).toEqual(["terminal-2"]);
    expect(terminalUiState.terminalGroups).toEqual([
      { id: "group-terminal-2", terminalIds: ["terminal-2"] },
    ]);
  });

  it("reconciles terminal ids from an external ordered list", () => {
    const store = useTerminalUiStateStore.getState();
    store.setTerminalOpen(TERMINAL_REF, true);
    store.reconcileTerminalIds(TERMINAL_REF, ["term-a", "term-b"]);

    const terminalUiState = selectTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByProjectKey,
      TERMINAL_REF,
    );
    expect(terminalUiState.terminalIds).toEqual(["term-a", "term-b"]);
    expect(terminalUiState.activeTerminalId).toBe("term-a");
    expect(terminalUiState.terminalGroups).toEqual([
      { id: "group-term-a", terminalIds: ["term-a"] },
      { id: "group-term-b", terminalIds: ["term-b"] },
    ]);
  });

  it("does not import a closed panel terminal from stale metadata", () => {
    const store = useTerminalUiStateStore.getState();
    store.newTerminal(TERMINAL_REF, "term-2");
    store.closeTerminal(TERMINAL_REF, "term-1");

    store.reconcileTerminalIds(TERMINAL_REF, ["term-1", "term-2"]);

    expect(
      selectTerminalUiState(
        useTerminalUiStateStore.getState().terminalUiStateByProjectKey,
        TERMINAL_REF,
      ).terminalIds,
    ).toEqual(["term-2"]);

    store.newTerminal(TERMINAL_REF, "term-1");
    expect(
      selectTerminalUiState(
        useTerminalUiStateStore.getState().terminalUiStateByProjectKey,
        TERMINAL_REF,
      ).terminalIds,
    ).toEqual(["term-2", "term-1"]);
  });

  it("is a no-op when clearing terminal UI state for a thread with no state", () => {
    const store = useTerminalUiStateStore.getState();
    const before = useTerminalUiStateStore.getState();

    store.clearTerminalUiState(TERMINAL_REF);

    expect(useTerminalUiStateStore.getState()).toBe(before);
  });
});
