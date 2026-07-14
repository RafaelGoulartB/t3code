"use client";

import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedProjectRef } from "@t3tools/contracts";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { FileIcon, FolderIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useClientSettings } from "../hooks/useSettings";
import { getLatestThreadForProject } from "../lib/threadSort";
import { isTerminalFocused } from "../lib/terminalFocus";
import { resolveShortcutCommand } from "../keybindings";
import { recentProjectFilesFor, useRecentProjectFilesStore } from "../recentProjectFilesStore";
import { projectEnvironment } from "../state/projects";
import { useEnvironmentQuery } from "../state/query";
import { useProjects, useThreadShells } from "../state/entities";
import { primaryServerKeybindingsAtom } from "../state/server";
import { buildThreadRouteParams } from "../threadRoutes";
import { openWorkspaceFile } from "../workspaceFileActions";
import type {
  CommandPaletteActionItem,
  CommandPaletteGroup,
  CommandPaletteSubmenuItem,
} from "./CommandPalette.logic";
import { CommandPaletteResults } from "./CommandPaletteResults";
import { filePathLabel, fileSearchPaths, recentFileSearchPaths } from "./FileSearchPalette.logic";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandFooter,
  CommandInput,
  CommandPanel,
} from "./ui/command";
import { Kbd, KbdGroup } from "./ui/kbd";
import { stackedThreadToast, toastManager } from "./ui/toast";

const FILE_SEARCH_REQUEST_LIMIT = 200;
const ITEM_ICON_CLASS = "size-4 text-muted-foreground/80";

type FileSearchTarget = {
  readonly projectRef: ScopedProjectRef;
  readonly threadRef: ReturnType<typeof scopeThreadRef>;
  readonly cwd: string;
};

function FileSearchPaletteDialog(props: { readonly setOpen: (open: boolean) => void }) {
  const navigate = useNavigate();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { activeDraftThread, activeThread, handleNewThread } = useHandleNewThread();
  const projects = useProjects();
  const threads = useThreadShells();
  const sidebarThreadSortOrder = useClientSettings((settings) => settings.sidebarThreadSortOrder);
  const pathsByProjectKey = useRecentProjectFilesStore((state) => state.pathsByProjectKey);
  const [query, setQuery] = useState("");
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);
  const [isSelectingProject, setIsSelectingProject] = useState(false);
  const [debouncedQuery] = useDebouncedValue(query, { wait: 120 });

  const target = useMemo<FileSearchTarget | null>(() => {
    const threadLike = activeThread
      ? {
          environmentId: activeThread.environmentId,
          projectId: activeThread.projectId,
          threadId: activeThread.id,
          worktreePath: activeThread.worktreePath,
        }
      : activeDraftThread
        ? {
            environmentId: activeDraftThread.environmentId,
            projectId: activeDraftThread.projectId,
            threadId: activeDraftThread.threadId,
            worktreePath: activeDraftThread.worktreePath,
          }
        : null;
    if (!threadLike) return null;

    const projectRef = scopeProjectRef(threadLike.environmentId, threadLike.projectId);
    const project = projects.find(
      (candidate) =>
        candidate.environmentId === projectRef.environmentId &&
        candidate.id === projectRef.projectId,
    );
    if (!project) return null;

    return {
      projectRef,
      threadRef: scopeThreadRef(threadLike.environmentId, threadLike.threadId),
      cwd: threadLike.worktreePath ?? project.workspaceRoot,
    };
  }, [activeDraftThread, activeThread, projects]);

  const targetKey = target
    ? `${target.projectRef.environmentId}:${target.projectRef.projectId}`
    : null;
  useEffect(() => {
    setQuery("");
    setHighlightedItemValue(null);
  }, [targetKey]);

  const searchQuery = target && debouncedQuery.trim().length > 0 ? debouncedQuery.trim() : null;
  const workspaceQuery = useEnvironmentQuery(
    target && searchQuery
      ? projectEnvironment.searchEntries({
          environmentId: target.projectRef.environmentId,
          input: { cwd: target.cwd, query: searchQuery, limit: FILE_SEARCH_REQUEST_LIMIT },
        })
      : null,
  );
  const recentPaths = useMemo(
    () =>
      target
        ? recentFileSearchPaths(recentProjectFilesFor(pathsByProjectKey, target.projectRef))
        : [],
    [pathsByProjectKey, target],
  );
  const isTypingSearch = Boolean(
    target &&
    query.trim().length > 0 &&
    (query.trim() !== debouncedQuery.trim() || workspaceQuery.isPending),
  );
  const displayedPaths =
    query.trim().length > 0
      ? isTypingSearch
        ? []
        : fileSearchPaths(workspaceQuery.data?.entries ?? [])
      : recentPaths;

  const selectProject = useCallback(
    async (projectRef: ScopedProjectRef) => {
      setIsSelectingProject(true);
      try {
        const latestThread = getLatestThreadForProject(
          threads.filter((thread) => thread.environmentId === projectRef.environmentId),
          projectRef.projectId,
          sidebarThreadSortOrder,
        );
        if (latestThread) {
          await navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(
              scopeThreadRef(latestThread.environmentId, latestThread.id),
            ),
          });
        } else {
          await handleNewThread(projectRef);
        }
      } finally {
        setIsSelectingProject(false);
      }
    },
    [handleNewThread, navigate, sidebarThreadSortOrder, threads],
  );

  const groups = useMemo<CommandPaletteGroup[]>(() => {
    if (!target) {
      const normalizedQuery = query.trim().toLowerCase();
      const items: CommandPaletteActionItem[] = projects
        .filter((project) => {
          if (!normalizedQuery) return true;
          return `${project.title} ${project.workspaceRoot}`
            .toLowerCase()
            .includes(normalizedQuery);
        })
        .map((project) => ({
          kind: "action",
          value: `project:${project.environmentId}:${project.id}`,
          searchTerms: [project.title, project.workspaceRoot],
          title: project.title,
          description: project.workspaceRoot,
          icon: <FolderIcon className={ITEM_ICON_CLASS} />,
          disabled: isSelectingProject,
          run: async () => selectProject(scopeProjectRef(project.environmentId, project.id)),
        }));
      return items.length > 0 ? [{ value: "projects", label: "Projects", items }] : [];
    }

    const items: CommandPaletteActionItem[] = displayedPaths.map((path) => {
      const { title, description } = filePathLabel(path);
      return {
        kind: "action",
        value: `file:${path}`,
        searchTerms: [path],
        title,
        description,
        icon: <FileIcon className={ITEM_ICON_CLASS} />,
        run: async () => {
          openWorkspaceFile({ threadRef: target.threadRef, relativePath: path });
        },
      };
    });
    return items.length > 0
      ? [
          {
            value: searchQuery ? "files" : "recent-files",
            label: searchQuery ? "Files" : "Recent files",
            items,
          },
        ]
      : [];
  }, [displayedPaths, isSelectingProject, projects, query, searchQuery, selectProject, target]);

  const emptyStateMessage = !target
    ? isSelectingProject
      ? "Opening project..."
      : "No projects match your search."
    : searchQuery
      ? query !== debouncedQuery || workspaceQuery.isPending
        ? "Searching files..."
        : workspaceQuery.error
          ? "Unable to search workspace files."
          : "No matching files."
      : "No recent files. Start typing to search the project.";

  const executeItem = useCallback(
    (item: CommandPaletteActionItem | CommandPaletteSubmenuItem) => {
      if (item.disabled) return;
      if (item.kind !== "action") return;
      if (target) props.setOpen(false);
      void item.run().catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to open file palette item",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          }),
        );
      });
    },
    [props, target],
  );

  return (
    <CommandDialogPopup
      aria-label="File search palette"
      className="overflow-hidden p-0"
      data-command-palette="true"
      data-file-search-palette="true"
      onBackdropPointerDown={() => props.setOpen(false)}
    >
      <Command
        aria-label="File search palette"
        autoHighlight="always"
        mode="none"
        onItemHighlighted={(value) => {
          setHighlightedItemValue(typeof value === "string" ? value : null);
        }}
        onValueChange={setQuery}
        value={query}
      >
        <CommandInput placeholder={target ? "Search project files..." : "Choose a project..."} />
        <CommandPanel className="max-h-[min(28rem,70vh)]">
          <CommandPaletteResults
            emptyStateMessage={emptyStateMessage}
            groups={groups}
            highlightedItemValue={highlightedItemValue}
            isActionsOnly={false}
            keybindings={keybindings}
            onExecuteItem={executeItem}
          />
        </CommandPanel>
        <CommandFooter>
          <KbdGroup className="items-center gap-1.5">
            <Kbd>Enter</Kbd>
            <span>Select</span>
          </KbdGroup>
          <KbdGroup className="items-center gap-1.5">
            <Kbd>Esc</Kbd>
            <span>Close</span>
          </KbdGroup>
        </CommandFooter>
      </Command>
    </CommandDialogPopup>
  );
}

export function FileSearchPalette() {
  const [open, setOpen] = useState(false);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);

  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: { terminalFocus: isTerminalFocused() },
      });
      if (command !== "filePalette.toggle") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen((current) => !current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keybindings]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      {open ? <FileSearchPaletteDialog setOpen={close} /> : null}
    </CommandDialog>
  );
}
