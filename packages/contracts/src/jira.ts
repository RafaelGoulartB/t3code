import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { PositiveInt, TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";

export const JiraConnectionState = Schema.Literals([
  "disabled",
  "cli_missing",
  "unauthenticated",
  "authenticated",
  "error",
]);
export type JiraConnectionState = typeof JiraConnectionState.Type;

export const JiraConnectionStatus = Schema.Struct({
  state: JiraConnectionState,
  message: TrimmedNonEmptyString,
  version: Schema.optional(TrimmedNonEmptyString),
  account: Schema.optional(TrimmedNonEmptyString),
  site: Schema.optional(TrimmedNonEmptyString),
});
export type JiraConnectionStatus = typeof JiraConnectionStatus.Type;

export const JiraSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  binaryPath: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed("acli"))),
});
export type JiraSettings = typeof JiraSettings.Type;

export const JiraProject = Schema.Struct({
  key: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
});
export type JiraProject = typeof JiraProject.Type;

export const JiraAssigneeScope = Schema.Literals(["mine", "all"]);
export type JiraAssigneeScope = typeof JiraAssigneeScope.Type;

export const JiraWorkItemListInput = Schema.Union([
  Schema.Struct({
    mode: Schema.Literal("filters"),
    assignee: JiraAssigneeScope,
    openOnly: Schema.Boolean,
    projectKey: Schema.optional(TrimmedNonEmptyString),
    limit: PositiveInt,
  }),
  Schema.Struct({
    mode: Schema.Literal("jql"),
    jql: TrimmedNonEmptyString,
    limit: PositiveInt,
  }),
]);
export type JiraWorkItemListInput = typeof JiraWorkItemListInput.Type;

export const JiraWorkItemSummary = Schema.Struct({
  key: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  projectKey: Schema.NullOr(Schema.String),
  issueType: Schema.NullOr(Schema.String),
  status: Schema.NullOr(Schema.String),
  priority: Schema.NullOr(Schema.String),
  assignee: Schema.NullOr(Schema.String),
  updatedAt: Schema.NullOr(Schema.String),
});
export type JiraWorkItemSummary = typeof JiraWorkItemSummary.Type;

export const JiraWorkItemListResult = Schema.Struct({
  items: Schema.Array(JiraWorkItemSummary),
  limit: PositiveInt,
  truncated: Schema.Boolean,
});
export type JiraWorkItemListResult = typeof JiraWorkItemListResult.Type;

export const JiraWorkItemDetailsInput = Schema.Struct({ key: TrimmedNonEmptyString });
export type JiraWorkItemDetailsInput = typeof JiraWorkItemDetailsInput.Type;

export const JiraAdditionalField = Schema.Struct({
  name: TrimmedNonEmptyString,
  value: TrimmedNonEmptyString,
});
export type JiraAdditionalField = typeof JiraAdditionalField.Type;

export const JiraWorkItemDetails = Schema.Struct({
  ...JiraWorkItemSummary.fields,
  description: Schema.String,
  reporter: Schema.NullOr(Schema.String),
  labels: Schema.Array(Schema.String),
  createdAt: Schema.NullOr(Schema.String),
  additionalFields: Schema.Array(JiraAdditionalField),
});
export type JiraWorkItemDetails = typeof JiraWorkItemDetails.Type;

export const JiraComment = Schema.Struct({
  id: Schema.NullOr(Schema.String),
  author: Schema.NullOr(Schema.String),
  body: Schema.String,
  createdAt: Schema.NullOr(Schema.String),
});
export type JiraComment = typeof JiraComment.Type;

export const JiraCommentListResult = Schema.Struct({ comments: Schema.Array(JiraComment) });
export type JiraCommentListResult = typeof JiraCommentListResult.Type;

const WorkItemKey = { key: TrimmedNonEmptyString } as const;
export const JiraWorkItemAction = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("create"),
    projectKey: TrimmedNonEmptyString,
    issueType: TrimmedNonEmptyString,
    summary: TrimmedNonEmptyString,
    description: Schema.optional(Schema.String),
    assignee: Schema.optional(TrimmedNonEmptyString),
    labels: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  }),
  Schema.Struct({
    ...WorkItemKey,
    kind: Schema.Literal("edit"),
    summary: Schema.optional(Schema.String),
    description: Schema.optional(Schema.String),
    labels: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  }),
  Schema.Struct({
    ...WorkItemKey,
    kind: Schema.Literal("assign"),
    assignee: Schema.optional(TrimmedNonEmptyString),
    unassign: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    ...WorkItemKey,
    kind: Schema.Literal("transition"),
    status: TrimmedNonEmptyString,
  }),
  Schema.Struct({ ...WorkItemKey, kind: Schema.Literal("comment"), body: TrimmedNonEmptyString }),
]);
export type JiraWorkItemAction = typeof JiraWorkItemAction.Type;

export const JiraActionResult = Schema.Struct({
  key: TrimmedNonEmptyString,
  kind: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
});
export type JiraActionResult = typeof JiraActionResult.Type;

export const JiraAuthSwitchInput = Schema.Struct({
  site: Schema.optional(TrimmedNonEmptyString),
  email: Schema.optional(TrimmedNonEmptyString),
});
export type JiraAuthSwitchInput = typeof JiraAuthSwitchInput.Type;

export class JiraError extends Schema.TaggedErrorClass<JiraError>()("JiraError", {
  operation: TrimmedNonEmptyString,
  detail: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Jira ${this.operation} failed: ${this.detail}`;
  }
}
