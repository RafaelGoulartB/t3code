import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  type JiraActionResult,
  type JiraAuthSwitchInput,
  type JiraComment,
  type JiraConnectionStatus,
  JiraError,
  type JiraProject,
  type JiraSprint,
  type JiraSprintListInput,
  type JiraSprintWorkItemGroup,
  type JiraSprintWorkItemsInput,
  type JiraWorkItemAction,
  type JiraWorkItemDetails,
  type JiraWorkItemListInput,
  type JiraWorkItemListResult,
} from "@t3tools/contracts";

import * as VcsProcess from "../vcs/VcsProcess.ts";

const DATA_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 300_000;
// ACLI accepts only a restricted field set for search. `updated` and `project`
// are rejected by current Windows releases, although they can appear in some
// response shapes, so normalization retains them when available.
const WORK_ITEM_FIELDS = "key,issuetype,summary,status,assignee,priority";
const decodeJson = Schema.decodeUnknownEffect(Schema.UnknownFromJsonString);

type CliContext = { readonly binaryPath: string; readonly cwd: string };
const isJiraError = Schema.is(JiraError);

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : typeof value === "string" && /^\d+$/.test(value) && Number(value) > 0
      ? Number(value)
      : null;
}

function display(value: unknown): string | null {
  const entry = record(value);
  return (
    string(value) ??
    string(entry.displayName) ??
    string(entry.name) ??
    string(entry.value) ??
    string(entry.key) ??
    null
  );
}

function parseJson(value: string, operation: string): Effect.Effect<unknown, JiraError> {
  // Some Windows ACLI builds print a BOM or a short prelude before their JSON
  // payload. Try only bounded JSON-shaped substrings and never forward output.
  const normalized = value.replace(/^\uFEFF/, "").trim();
  const candidates = [normalized];
  for (const [startToken, endToken] of [
    ["{", "}"],
    ["[", "]"],
  ] as const) {
    const start = normalized.indexOf(startToken);
    const end = normalized.lastIndexOf(endToken);
    if (start >= 0 && end > start) candidates.push(normalized.slice(start, end + 1));
  }
  const decoded = candidates
    .slice(1)
    .reduce(
      (attempt, candidate) => attempt.pipe(Effect.catch(() => decodeJson(candidate))),
      decodeJson(candidates[0] ?? ""),
    );
  return decoded.pipe(
    Effect.mapError(
      (cause) =>
        new JiraError({ operation, detail: "Atlassian CLI returned invalid JSON.", cause }),
    ),
  );
}

function workItem(value: unknown) {
  const entry = record(value);
  const fields = record(entry.fields);
  const key = string(entry.key) ?? string(fields.key) ?? "UNKNOWN";
  return {
    key,
    summary: string(entry.summary) ?? string(fields.summary) ?? key,
    projectKey: string(entry.projectKey) ?? string(record(fields.project).key),
    issueType: display(entry.issueType ?? entry.issuetype ?? fields.issuetype),
    status: display(entry.status ?? fields.status),
    priority: display(entry.priority ?? fields.priority),
    assignee: display(entry.assignee ?? fields.assignee),
    updatedAt: string(entry.updated) ?? string(entry.updatedAt) ?? string(fields.updated),
  };
}

function collection(value: unknown, names: ReadonlyArray<string>): ReadonlyArray<unknown> {
  if (Array.isArray(value)) return value;
  const entry = record(value);
  for (const name of names) {
    if (Array.isArray(entry[name])) return entry[name] as ReadonlyArray<unknown>;
  }
  return [];
}

/** ACLI uses different response envelopes per resource and per release. */
export function workItemsFromCliJson(value: unknown): ReadonlyArray<unknown> {
  return collection(value, ["issues", "workItems", "values", "items"]);
}

export function commentsFromCliJson(value: unknown, depth = 0): ReadonlyArray<unknown> {
  const entries = collection(value, ["comments", "values", "items", "results"]);
  if (entries.length > 0 || depth >= 3) return entries;

  // ACLI has returned both `{ comments: [...] }` and nested work-item/result
  // envelopes across releases. Only descend through known container keys.
  const container = record(value);
  for (const name of ["comments", "comment", "result", "data", "issue", "workItem", "fields"]) {
    const nested = container[name];
    if (nested !== undefined) {
      const nestedEntries = commentsFromCliJson(nested, depth + 1);
      if (nestedEntries.length > 0) return nestedEntries;
    }
  }
  return [];
}

function plainText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value
      .map(plainText)
      .filter((part): part is string => part !== null && part !== "");
    return parts.length > 0 ? parts.join("\n") : null;
  }
  const entry = record(value);
  const text = string(entry.text);
  if (text) return text;
  return entry.content === undefined ? null : plainText(entry.content);
}

function normalizeComments(output: unknown): ReadonlyArray<JiraComment> {
  return commentsFromCliJson(output).map((entry) => {
    const value = record(entry);
    return {
      id: string(value.id),
      author: display(value.author),
      body: plainText(value.body) ?? "",
      createdAt: string(value.created) ?? string(value.createdAt),
    };
  });
}

export function sprintsFromCliJson(value: unknown): ReadonlyArray<unknown> {
  return collection(value, ["sprints", "values", "items"]);
}

function projectsFromCliJson(value: unknown): ReadonlyArray<unknown> {
  return collection(value, ["projects", "values", "items"]);
}

function boardsFromCliJson(value: unknown): ReadonlyArray<unknown> {
  return collection(value, ["boards", "values", "items"]);
}

function additionalFields(fields: Record<string, unknown>) {
  const core = new Set([
    "key",
    "summary",
    "project",
    "issuetype",
    "status",
    "priority",
    "assignee",
    "reporter",
    "labels",
    "description",
    "created",
    "updated",
    "subtasks",
    "issuelinks",
    "issuelinks",
  ]);
  return Object.entries(fields)
    .filter(([name]) => !core.has(name.toLowerCase()))
    .map(([name, value]) => {
      const rendered = Array.isArray(value)
        ? value
            .map(display)
            .filter((entry): entry is string => entry !== null)
            .join(", ")
        : (display(value) ??
          (typeof value === "number" || typeof value === "boolean" ? String(value) : null));
      return rendered ? { name, value: rendered } : null;
    })
    .filter((entry): entry is { name: string; value: string } => entry !== null);
}

function relatedSummary(value: unknown, relationship: unknown = null) {
  const summary = workItem(value);
  return {
    key: summary.key,
    summary: summary.summary,
    status: summary.status,
    relationship: string(relationship),
  };
}

function subtasksFromFields(fields: Record<string, unknown>) {
  return collection(fields.subtasks, ["values", "items"])
    .map((entry) => {
      const summary = workItem(entry);
      return { key: summary.key, summary: summary.summary, status: summary.status };
    })
    .filter((entry) => entry.key !== "UNKNOWN");
}

function relatedWorkItemsFromFields(fields: Record<string, unknown>) {
  const links = collection(fields.issuelinks ?? fields.issueLinks, ["values", "items"]);
  return links
    .flatMap((link) => {
      const value = record(link);
      const type = record(value.type);
      const inward = value.inwardIssue ?? value.inwardWorkItem;
      const outward = value.outwardIssue ?? value.outwardWorkItem;
      const related = inward
        ? relatedSummary(inward, type.inward ?? type.name)
        : outward
          ? relatedSummary(outward, type.outward ?? type.name)
          : null;
      return related && related.key !== "UNKNOWN" ? [related] : [];
    })
    .filter(
      (item, index, all) => all.findIndex((candidate) => candidate.key === item.key) === index,
    );
}

function jql(input: JiraWorkItemListInput): string {
  if (input.mode === "jql") return input.jql;
  const clauses: string[] = [];
  if (input.assignee === "mine") clauses.push("assignee = currentUser()");
  if (input.openOnly) clauses.push("statusCategory != Done");
  if (input.projectKey) {
    const projectKey = input.projectKey.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    clauses.push(`project = "${projectKey}"`);
  }
  if (input.sprintId) clauses.push(`sprint = ${input.sprintId}`);
  return `${clauses.length > 0 ? clauses.join(" AND ") : "project IS NOT EMPTY"} ORDER BY updated DESC`;
}

function jiraError(operation: string, error: unknown): JiraError {
  if (isJiraError(error)) return error;
  const tag = record(error)._tag;
  if (tag === "VcsProcessSpawnError") {
    return new JiraError({
      operation,
      detail: "Atlassian CLI (`acli`) was not found at the configured path.",
    });
  }
  if (tag === "VcsProcessExitError" && record(error).failureKind === "authentication") {
    return new JiraError({
      operation,
      detail: "Jira is not signed in. Sign in with the Atlassian CLI and retry.",
    });
  }
  if (tag === "VcsProcessTimeoutError") {
    return new JiraError({ operation, detail: "The Atlassian CLI timed out. Please retry." });
  }
  return new JiraError({ operation, detail: "Atlassian CLI command failed." });
}

export class JiraCli extends Context.Service<
  JiraCli,
  {
    readonly status: (input: CliContext) => Effect.Effect<JiraConnectionStatus, never>;
    readonly login: (input: CliContext) => Effect.Effect<JiraConnectionStatus, JiraError>;
    readonly logout: (input: CliContext) => Effect.Effect<JiraConnectionStatus, JiraError>;
    readonly switchAccount: (
      input: CliContext & JiraAuthSwitchInput,
    ) => Effect.Effect<JiraConnectionStatus, JiraError>;
    readonly projects: (input: CliContext) => Effect.Effect<ReadonlyArray<JiraProject>, JiraError>;
    readonly sprints: (
      input: CliContext & JiraSprintListInput,
    ) => Effect.Effect<ReadonlyArray<JiraSprint>, JiraError>;
    readonly listWorkItems: (
      input: CliContext & { readonly input: JiraWorkItemListInput },
    ) => Effect.Effect<JiraWorkItemListResult, JiraError>;
    readonly listSprintWorkItems: (
      input: CliContext & { readonly input: JiraSprintWorkItemsInput },
    ) => Effect.Effect<ReadonlyArray<JiraSprintWorkItemGroup>, JiraError>;
    readonly getWorkItem: (
      input: CliContext & { readonly key: string },
    ) => Effect.Effect<JiraWorkItemDetails, JiraError>;
    readonly comments: (
      input: CliContext & { readonly key: string },
    ) => Effect.Effect<ReadonlyArray<JiraComment>, JiraError>;
    readonly action: (
      input: CliContext & { readonly action: JiraWorkItemAction },
    ) => Effect.Effect<JiraActionResult, JiraError>;
    readonly openInBrowser: (
      input: CliContext & { readonly key: string },
    ) => Effect.Effect<JiraActionResult, JiraError>;
  }
>()("t3/jira/JiraCli") {}

export const make = Effect.gen(function* () {
  const process = yield* VcsProcess.VcsProcess;
  const run = Effect.fn("JiraCli.run")(function* (
    input: CliContext & {
      readonly operation: string;
      readonly args: ReadonlyArray<string>;
      readonly timeoutMs?: number;
    },
  ) {
    return yield* process
      .run({
        operation: `jira.${input.operation}`,
        command: input.binaryPath,
        args: input.args,
        cwd: input.cwd,
        timeoutMs: input.timeoutMs ?? DATA_TIMEOUT_MS,
      })
      .pipe(Effect.mapError((error) => jiraError(input.operation, error)));
  });

  const status = Effect.fn("JiraCli.status")(function* (input: CliContext) {
    const version = yield* run({ ...input, operation: "status", args: ["--version"] }).pipe(
      Effect.map((result) => result.stdout.trim()),
      Effect.catch((error) =>
        Effect.succeed<JiraConnectionStatus>({
          state: error.detail.includes("not found") ? "cli_missing" : "error",
          message: error.detail,
        }),
      ),
    );
    if (typeof version !== "string") return version;
    return yield* run({ ...input, operation: "status", args: ["jira", "auth", "status"] }).pipe(
      Effect.as({
        state: "authenticated" as const,
        message: "Connected",
        ...(version ? { version } : {}),
      }),
      Effect.catch((error) =>
        Effect.succeed({
          state: error.detail.includes("not signed in")
            ? ("unauthenticated" as const)
            : ("error" as const),
          message: error.detail,
          ...(version ? { version } : {}),
        }),
      ),
    );
  });

  const login = (input: CliContext) =>
    run({
      ...input,
      operation: "login",
      args: ["jira", "auth", "login", "--web"],
      timeoutMs: LOGIN_TIMEOUT_MS,
    }).pipe(Effect.andThen(status(input)));
  const logout = (input: CliContext) =>
    run({ ...input, operation: "logout", args: ["jira", "auth", "logout"] }).pipe(
      Effect.andThen(status(input)),
    );
  const switchAccount = (input: CliContext & JiraAuthSwitchInput) => {
    if (!input.site && !input.email) {
      return Effect.fail(
        new JiraError({
          operation: "switch account",
          detail: "Provide a Jira site or account email.",
        }),
      );
    }
    const args = ["jira", "auth", "switch"];
    if (input.site) args.push("--site", input.site);
    if (input.email) args.push("--email", input.email);
    return run({ ...input, operation: "switch account", args }).pipe(Effect.andThen(status(input)));
  };
  const projects = (input: CliContext) =>
    run({
      ...input,
      operation: "list projects",
      args: ["jira", "project", "list", "--limit", "100", "--json"],
    }).pipe(
      Effect.flatMap((result) =>
        parseJson(result.stdout, "list projects").pipe(
          Effect.map((output) =>
            projectsFromCliJson(output)
              .map((entry) => {
                const value = record(entry);
                const key = string(value.key);
                const name = string(value.name);
                return key && name ? { key, name } : null;
              })
              .filter((entry): entry is JiraProject => entry !== null),
          ),
        ),
      ),
    );
  const sprints = Effect.fn("JiraCli.sprints")(function* (input: CliContext & JiraSprintListInput) {
    const boardArgs = ["jira", "board", "search", "--limit", "50", "--json"];
    if (input.projectKey) boardArgs.push("--project", input.projectKey);
    const boardResult = yield* run({ ...input, operation: "list sprint boards", args: boardArgs });
    const boards = yield* parseJson(boardResult.stdout, "list sprint boards").pipe(
      Effect.map((output) =>
        boardsFromCliJson(output)
          .map((entry) => {
            const id = positiveInt(record(entry).id);
            return id ? { id } : null;
          })
          .filter((entry): entry is { id: number } => entry !== null),
      ),
    );
    const result: JiraSprint[] = [];
    for (const board of boards) {
      const output = yield* run({
        ...input,
        operation: "list sprints",
        args: [
          "jira",
          "board",
          "list-sprints",
          "--id",
          String(board.id),
          "--state",
          "active,future",
          "--limit",
          "50",
          "--json",
        ],
      });
      const parsed = yield* parseJson(output.stdout, "list sprints");
      for (const entry of sprintsFromCliJson(parsed)) {
        const value = record(entry);
        const id = positiveInt(value.id);
        const name = string(value.name);
        const state = string(value.state)?.toLowerCase();
        if (id && name && (state === "active" || state === "future" || state === "closed")) {
          result.push({ id, boardId: board.id, name, state });
        }
      }
    }
    return result.sort((left, right) => left.name.localeCompare(right.name) || left.id - right.id);
  });
  const listWorkItems = (input: CliContext & { readonly input: JiraWorkItemListInput }) =>
    run({
      ...input,
      operation: "list work items",
      args: [
        "jira",
        "workitem",
        "search",
        "--jql",
        jql(input.input),
        "--fields",
        WORK_ITEM_FIELDS,
        "--limit",
        String(input.input.limit),
        "--json",
      ],
    }).pipe(
      Effect.flatMap((result) =>
        parseJson(result.stdout, "list work items").pipe(
          Effect.map((output) => {
            const value = workItemsFromCliJson(output);
            return {
              items: value.map(workItem),
              limit: input.input.limit,
              truncated: value.length >= input.input.limit,
            };
          }),
        ),
      ),
    );
  const listSprintWorkItems = Effect.fn("JiraCli.listSprintWorkItems")(function* (
    input: CliContext & { readonly input: JiraSprintWorkItemsInput },
  ) {
    const groups: JiraSprintWorkItemGroup[] = [];
    const seenWorkItemKeys = new Set<string>();
    const perSprintLimit = Math.max(
      1,
      Math.floor(input.input.input.limit / Math.max(input.input.sprints.length, 1)),
    );
    for (const sprint of input.input.sprints.slice(0, 8)) {
      const result = yield* run({
        ...input,
        operation: "list sprint work items",
        args: [
          "jira",
          "sprint",
          "list-workitems",
          "--board",
          String(sprint.boardId),
          "--sprint",
          String(sprint.id),
          "--jql",
          jql(input.input.input as JiraWorkItemListInput),
          "--fields",
          WORK_ITEM_FIELDS,
          "--limit",
          String(perSprintLimit),
          "--json",
        ],
      });
      const parsed = yield* parseJson(result.stdout, "list sprint work items");
      const workItems = workItemsFromCliJson(parsed)
        .map(workItem)
        .filter((workItem) => {
          if (seenWorkItemKeys.has(workItem.key)) return false;
          seenWorkItemKeys.add(workItem.key);
          return true;
        });
      groups.push({ sprint, items: workItems, truncated: workItems.length >= perSprintLimit });
    }
    return groups;
  });
  const getWorkItem = (input: CliContext & { readonly key: string }) =>
    run({
      ...input,
      operation: "get work item",
      args: ["jira", "workitem", "view", input.key, "--fields", "*all", "--json"],
    }).pipe(
      Effect.flatMap((result) =>
        parseJson(result.stdout, "get work item").pipe(
          Effect.map((output) => {
            const value = record(output);
            const summary = workItem(value);
            const fields = record(value.fields);
            const rawLabels = value.labels ?? fields.labels;
            const labels = Array.isArray(rawLabels)
              ? rawLabels
                  .map((item) => display(item))
                  .filter((item): item is string => item !== null)
              : [];
            return {
              ...summary,
              description: string(value.description) ?? string(fields.description) ?? "",
              reporter: display(value.reporter ?? fields.reporter),
              labels,
              createdAt: string(value.created) ?? string(value.createdAt) ?? string(fields.created),
              additionalFields: additionalFields(fields),
              subtasks: subtasksFromFields(fields),
              relatedWorkItems: relatedWorkItemsFromFields(fields),
            };
          }),
        ),
      ),
    );
  const comments = (input: CliContext & { readonly key: string }) => {
    const decodeComments = (stdout: string, operation: string) =>
      parseJson(stdout, operation).pipe(Effect.map(normalizeComments));
    const fallback = run({
      ...input,
      operation: "get comments from work item",
      args: ["jira", "workitem", "view", input.key, "--fields", "*all", "--json"],
    }).pipe(
      Effect.flatMap((result) => decodeComments(result.stdout, "get comments from work item")),
    );
    return run({
      ...input,
      operation: "list comments",
      args: ["jira", "workitem", "comment", "list", "--key", input.key, "--paginate", "--json"],
    }).pipe(
      Effect.flatMap((result) => decodeComments(result.stdout, "list comments")),
      Effect.catch((error) =>
        error.detail === "Atlassian CLI returned invalid JSON." ? fallback : Effect.fail(error),
      ),
    );
  };
  const action = (input: CliContext & { readonly action: JiraWorkItemAction }) => {
    const action = input.action;
    const args = ["jira", "workitem"];
    let key = "created work item";
    if (action.kind === "create") {
      args.push(
        "create",
        "--project",
        action.projectKey,
        "--type",
        action.issueType,
        "--summary",
        action.summary,
      );
      if (action.description !== undefined) args.push("--description", action.description);
      if (action.assignee !== undefined) args.push("--assignee", action.assignee);
      if (action.labels?.length) args.push("--label", action.labels.join(","));
    } else if (action.kind === "edit") {
      key = action.key;
      args.push("edit", "--key", action.key, "--yes");
      if (action.summary !== undefined) args.push("--summary", action.summary);
      if (action.description !== undefined) args.push("--description", action.description);
      if (action.labels !== undefined) args.push("--labels", action.labels.join(","));
    } else if (action.kind === "assign") {
      key = action.key;
      args.push("assign", "--key", action.key, "--yes");
      if (action.unassign) {
        args.push("--remove-assignee");
      } else {
        args.push("--assignee", action.assignee ?? "@me");
      }
    } else if (action.kind === "transition") {
      key = action.key;
      args.push("transition", "--key", action.key, "--status", action.status, "--yes");
    } else {
      key = action.key;
      args.push("comment", "create", "--key", action.key, "--body", action.body);
    }
    args.push("--json");
    return run({ ...input, operation: action.kind, args }).pipe(
      Effect.flatMap((result): Effect.Effect<JiraActionResult, JiraError> => {
        if (action.kind !== "create") {
          return Effect.succeed<JiraActionResult>({
            key,
            kind: action.kind,
            message: "Jira work item updated.",
          });
        }
        return parseJson(result.stdout, "create").pipe(
          Effect.map((output) => ({
            key: workItem(output).key,
            kind: action.kind,
            message: "Jira work item created.",
          })),
        );
      }),
    );
  };
  const openInBrowser = (input: CliContext & { readonly key: string }) =>
    run({
      ...input,
      operation: "open in browser",
      args: ["jira", "workitem", "view", input.key, "--web"],
    }).pipe(Effect.as({ key: input.key, kind: "open", message: "Opened Jira in the browser." }));
  return JiraCli.of({
    status,
    login,
    logout,
    switchAccount,
    projects,
    sprints,
    listWorkItems,
    listSprintWorkItems,
    getWorkItem,
    comments,
    action,
    openInBrowser,
  });
});

export const layer = Layer.effect(JiraCli, make);
