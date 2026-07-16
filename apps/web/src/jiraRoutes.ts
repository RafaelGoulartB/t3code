import type { JiraAssigneeScope, JiraWorkItemListInput } from "@t3tools/contracts";

export interface JiraSearch {
  readonly environment?: string;
  readonly assignee?: JiraAssigneeScope;
  readonly open?: boolean;
  readonly project?: string;
  readonly view?: "board" | "list";
  readonly limit?: number;
  readonly jql?: string;
}

export type ResolvedJiraSearch = Omit<JiraSearch, "assignee" | "open" | "view" | "limit"> & {
  readonly assignee: JiraAssigneeScope;
  readonly open: boolean;
  readonly view: "board" | "list";
  readonly limit: number;
};

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function parseJiraSearch(input: Record<string, unknown>): JiraSearch {
  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.min(100, Math.max(10, Math.round(input.limit)))
      : 50;
  const environment = text(input.environment);
  const project = text(input.project);
  const jql = text(input.jql);
  return {
    ...(environment ? { environment } : {}),
    assignee: input.assignee === "all" ? "all" : "mine",
    open: input.open !== false,
    ...(project ? { project } : {}),
    view: input.view === "list" ? "list" : "board",
    limit,
    ...(jql ? { jql } : {}),
  };
}

export function resolveJiraSearch(search: JiraSearch): ResolvedJiraSearch {
  return {
    ...search,
    assignee: search.assignee ?? "mine",
    open: search.open ?? true,
    view: search.view ?? "board",
    limit: search.limit ?? 50,
  };
}

export function jiraSearchToInput(search: JiraSearch): JiraWorkItemListInput {
  const resolved = resolveJiraSearch(search);
  return resolved.jql
    ? { mode: "jql", jql: resolved.jql, limit: resolved.limit }
    : {
        mode: "filters",
        assignee: resolved.assignee,
        openOnly: resolved.open,
        ...(resolved.project ? { projectKey: resolved.project } : {}),
        limit: resolved.limit,
      };
}
