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
  return decodeJson(value).pipe(
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

function items(value: unknown): ReadonlyArray<unknown> {
  if (Array.isArray(value)) return value;
  const entry = record(value);
  for (const name of ["issues", "workItems", "values", "items"]) {
    if (Array.isArray(entry[name])) return entry[name] as ReadonlyArray<unknown>;
  }
  return [];
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

function jql(input: JiraWorkItemListInput): string {
  if (input.mode === "jql") return input.jql;
  const clauses: string[] = [];
  if (input.assignee === "mine") clauses.push("assignee = currentUser()");
  if (input.openOnly) clauses.push("statusCategory != Done");
  if (input.projectKey) {
    const projectKey = input.projectKey.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    clauses.push(`project = "${projectKey}"`);
  }
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
    readonly listWorkItems: (
      input: CliContext & { readonly input: JiraWorkItemListInput },
    ) => Effect.Effect<JiraWorkItemListResult, JiraError>;
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
            items(output)
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
            const value = items(output);
            return {
              items: value.map(workItem),
              limit: input.input.limit,
              truncated: value.length >= input.input.limit,
            };
          }),
        ),
      ),
    );
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
            };
          }),
        ),
      ),
    );
  const comments = (input: CliContext & { readonly key: string }) =>
    run({
      ...input,
      operation: "list comments",
      args: ["jira", "workitem", "comment", "list", "--key", input.key, "--limit", "100", "--json"],
    }).pipe(
      Effect.flatMap((result) =>
        parseJson(result.stdout, "list comments").pipe(
          Effect.map((output) =>
            items(output).map((entry) => {
              const value = record(entry);
              return {
                id: string(value.id),
                author: display(value.author),
                body: string(value.body) ?? "",
                createdAt: string(value.created) ?? string(value.createdAt),
              };
            }),
          ),
        ),
      ),
    );
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
    listWorkItems,
    getWorkItem,
    comments,
    action,
    openInBrowser,
  });
});

export const layer = Layer.effect(JiraCli, make);
