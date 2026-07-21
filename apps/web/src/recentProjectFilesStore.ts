import { scopedProjectKey } from "@t3tools/client-runtime/environment";
import type { ScopedProjectRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

export const MAX_RECENT_PROJECT_FILES = 20;
export const RECENT_PROJECT_FILES_DISPLAY_LIMIT = 8;

interface RecentProjectFilesState {
  readonly pathsByProjectKey: Record<string, readonly string[]>;
  readonly record: (projectRef: ScopedProjectRef, relativePath: string) => void;
}

function normalizePersistedPaths(value: unknown): Record<string, readonly string[]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};

  const pathsByProjectKey: Record<string, readonly string[]> = {};
  for (const [projectKey, paths] of Object.entries(value)) {
    if (!Array.isArray(paths)) continue;
    const uniquePaths = [
      ...new Set(paths.filter((path): path is string => typeof path === "string")),
    ]
      .filter((path) => path.trim().length > 0)
      .slice(0, MAX_RECENT_PROJECT_FILES);
    if (uniquePaths.length > 0) {
      pathsByProjectKey[projectKey] = uniquePaths;
    }
  }
  return pathsByProjectKey;
}

export const useRecentProjectFilesStore = create<RecentProjectFilesState>()(
  persist(
    (set) => ({
      pathsByProjectKey: {},
      record: (projectRef, relativePath) => {
        const normalizedPath = relativePath.trim();
        if (!normalizedPath) return;
        const projectKey = scopedProjectKey(projectRef);
        set((state) => ({
          pathsByProjectKey: {
            ...state.pathsByProjectKey,
            [projectKey]: [
              normalizedPath,
              ...(state.pathsByProjectKey[projectKey] ?? []).filter(
                (path) => path !== normalizedPath,
              ),
            ].slice(0, MAX_RECENT_PROJECT_FILES),
          },
        }));
      },
    }),
    {
      name: "t3code:recent-project-files:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as { pathsByProjectKey?: unknown } | undefined;
        return {
          ...currentState,
          pathsByProjectKey: normalizePersistedPaths(persisted?.pathsByProjectKey),
        };
      },
    },
  ),
);

export function recentProjectFilesFor(
  pathsByProjectKey: Record<string, readonly string[]>,
  projectRef: ScopedProjectRef,
): readonly string[] {
  return (pathsByProjectKey[scopedProjectKey(projectRef)] ?? []).slice(
    0,
    RECENT_PROJECT_FILES_DISPLAY_LIMIT,
  );
}
