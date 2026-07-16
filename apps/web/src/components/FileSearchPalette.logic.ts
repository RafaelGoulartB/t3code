import type { ProjectEntry } from "@t3tools/contracts";

import { RECENT_PROJECT_FILES_DISPLAY_LIMIT } from "../recentProjectFilesStore";

export const FILE_SEARCH_RESULT_LIMIT = 8;

export function fileSearchPaths(entries: ReadonlyArray<ProjectEntry>): string[] {
  return entries
    .filter((entry) => entry.kind === "file")
    .map((entry) => entry.path)
    .slice(0, FILE_SEARCH_RESULT_LIMIT);
}

export function recentFileSearchPaths(paths: ReadonlyArray<string>): string[] {
  return [...new Set(paths.filter((path) => path.trim().length > 0))].slice(
    0,
    RECENT_PROJECT_FILES_DISPLAY_LIMIT,
  );
}

export function filePathLabel(path: string): {
  readonly title: string;
  readonly description: string;
} {
  const separatorIndex = path.lastIndexOf("/");
  return separatorIndex === -1
    ? { title: path, description: "Project root" }
    : { title: path.slice(separatorIndex + 1), description: path.slice(0, separatorIndex) };
}
