import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const GitHubPullRequestPreset = Schema.Literals([
  "mine",
  "involvement",
  "review_requested",
  "checks_failed",
  "changes_requested",
  "all",
]);
export type GitHubPullRequestPreset = typeof GitHubPullRequestPreset.Type;

export const GitHubPullRequestStateFilter = Schema.Literals(["open", "closed", "merged", "all"]);
export type GitHubPullRequestStateFilter = typeof GitHubPullRequestStateFilter.Type;

export const GitHubPullRequestReviewFilter = Schema.Literals([
  "none",
  "required",
  "approved",
  "changes_requested",
]);
export type GitHubPullRequestReviewFilter = typeof GitHubPullRequestReviewFilter.Type;

export const GitHubPullRequestChecksFilter = Schema.Literals(["pending", "success", "failure"]);
export type GitHubPullRequestChecksFilter = typeof GitHubPullRequestChecksFilter.Type;

export const GitHubPullRequestCiStatus = Schema.Literals([
  "success",
  "failure",
  "pending",
  "none",
  "unknown",
]);
export type GitHubPullRequestCiStatus = typeof GitHubPullRequestCiStatus.Type;

export const GitHubPullRequestReviewStatus = Schema.Literals([
  "approved",
  "changes_requested",
  "pending",
  "none",
  "unknown",
]);
export type GitHubPullRequestReviewStatus = typeof GitHubPullRequestReviewStatus.Type;

export const GitHubPullRequestSort = Schema.Literals(["best-match", "created", "updated"]);
export type GitHubPullRequestSort = typeof GitHubPullRequestSort.Type;

const GitHubActor = Schema.Struct({ login: TrimmedNonEmptyString });
export type GitHubActor = typeof GitHubActor.Type;

export const GitHubPullRequestLabel = Schema.Struct({
  name: TrimmedNonEmptyString,
  color: Schema.optional(Schema.String),
});
export type GitHubPullRequestLabel = typeof GitHubPullRequestLabel.Type;

export const GitHubPullRequestListInput = Schema.Struct({
  preset: Schema.optional(GitHubPullRequestPreset),
  state: Schema.optional(GitHubPullRequestStateFilter),
  organization: Schema.optional(TrimmedNonEmptyString),
  repository: Schema.optional(TrimmedNonEmptyString),
  author: Schema.optional(TrimmedNonEmptyString),
  reviewRequested: Schema.optional(TrimmedNonEmptyString),
  review: Schema.optional(GitHubPullRequestReviewFilter),
  checks: Schema.optional(GitHubPullRequestChecksFilter),
  label: Schema.optional(TrimmedNonEmptyString),
  query: Schema.optional(Schema.String),
  sort: Schema.optional(GitHubPullRequestSort),
  limit: Schema.optional(PositiveInt),
});
export type GitHubPullRequestListInput = typeof GitHubPullRequestListInput.Type;

export const GitHubPullRequestListItem = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  repository: TrimmedNonEmptyString,
  author: Schema.NullOr(TrimmedNonEmptyString),
  state: Schema.Literals(["open", "closed", "merged"]),
  isDraft: Schema.Boolean,
  createdAt: Schema.NullOr(Schema.String),
  updatedAt: Schema.NullOr(Schema.String),
  labels: Schema.Array(GitHubPullRequestLabel),
  ciStatus: GitHubPullRequestCiStatus,
  reviewStatus: GitHubPullRequestReviewStatus,
  hasConflicts: Schema.Boolean,
});
export type GitHubPullRequestListItem = typeof GitHubPullRequestListItem.Type;

export const GitHubPullRequestListResult = Schema.Struct({
  items: Schema.Array(GitHubPullRequestListItem),
  limit: PositiveInt,
  truncated: Schema.Boolean,
});
export type GitHubPullRequestListResult = typeof GitHubPullRequestListResult.Type;

export const GitHubPullRequestDetailsInput = Schema.Struct({
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
});
export type GitHubPullRequestDetailsInput = typeof GitHubPullRequestDetailsInput.Type;

export const GitHubPullRequestReview = Schema.Struct({
  author: Schema.NullOr(GitHubActor),
  state: Schema.String,
  body: Schema.String,
  submittedAt: Schema.NullOr(Schema.String),
});
export type GitHubPullRequestReview = typeof GitHubPullRequestReview.Type;

export const GitHubPullRequestComment = Schema.Struct({
  author: Schema.NullOr(GitHubActor),
  body: Schema.String,
  createdAt: Schema.NullOr(Schema.String),
});
export type GitHubPullRequestComment = typeof GitHubPullRequestComment.Type;

export const GitHubPullRequestReviewThread = Schema.Struct({
  path: TrimmedNonEmptyString,
  line: Schema.NullOr(PositiveInt),
  originalLine: Schema.NullOr(PositiveInt),
  isResolved: Schema.Boolean,
  isOutdated: Schema.Boolean,
  comments: Schema.Array(GitHubPullRequestComment),
});
export type GitHubPullRequestReviewThread = typeof GitHubPullRequestReviewThread.Type;

export const GitHubPullRequestCheck = Schema.Struct({
  name: TrimmedNonEmptyString,
  state: Schema.String,
  bucket: Schema.String,
  description: Schema.String,
  link: Schema.NullOr(Schema.String),
  workflow: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.String),
});
export type GitHubPullRequestCheck = typeof GitHubPullRequestCheck.Type;

export const GitHubPullRequestDetails = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  body: Schema.String,
  url: TrimmedNonEmptyString,
  repository: TrimmedNonEmptyString,
  author: Schema.NullOr(GitHubActor),
  state: Schema.Literals(["open", "closed", "merged"]),
  isDraft: Schema.Boolean,
  baseRefName: TrimmedNonEmptyString,
  headRefName: TrimmedNonEmptyString,
  createdAt: Schema.NullOr(Schema.String),
  updatedAt: Schema.NullOr(Schema.String),
  mergedAt: Schema.NullOr(Schema.String),
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  changedFiles: NonNegativeInt,
  reviewDecision: Schema.NullOr(Schema.String),
  mergeable: Schema.NullOr(Schema.String),
  mergeStateStatus: Schema.NullOr(Schema.String),
  hasConflicts: Schema.Boolean,
  labels: Schema.Array(GitHubPullRequestLabel),
  assignees: Schema.Array(GitHubActor),
  reviewRequests: Schema.Array(GitHubActor),
  reviews: Schema.Array(GitHubPullRequestReview),
  comments: Schema.Array(GitHubPullRequestComment),
  reviewThreads: Schema.Array(GitHubPullRequestReviewThread),
  checks: Schema.Array(GitHubPullRequestCheck),
});
export type GitHubPullRequestDetails = typeof GitHubPullRequestDetails.Type;

export const GitHubPullRequestChecksResult = Schema.Struct({
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
  checks: Schema.Array(GitHubPullRequestCheck),
});
export type GitHubPullRequestChecksResult = typeof GitHubPullRequestChecksResult.Type;

export const GitHubPullRequestDiffResult = Schema.Struct({
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
  diff: Schema.String,
  truncated: Schema.Boolean,
});
export type GitHubPullRequestDiffResult = typeof GitHubPullRequestDiffResult.Type;

const PullRequestTarget = {
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
} as const;

const LabelsAction = Schema.Struct({
  ...PullRequestTarget,
  kind: Schema.Literal("labels"),
  add: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  remove: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});

const AssigneesAction = Schema.Struct({
  ...PullRequestTarget,
  kind: Schema.Literal("assignees"),
  add: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  remove: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});

const ReviewersAction = Schema.Struct({
  ...PullRequestTarget,
  kind: Schema.Literal("reviewers"),
  add: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  remove: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});

export const GitHubPullRequestAction = Schema.Union([
  Schema.Struct({
    ...PullRequestTarget,
    kind: Schema.Literal("edit"),
    title: Schema.optional(Schema.String),
    body: Schema.optional(Schema.String),
  }),
  Schema.Struct({ ...PullRequestTarget, kind: Schema.Literal("comment"), body: Schema.String }),
  Schema.Struct({
    ...PullRequestTarget,
    kind: Schema.Literal("review"),
    decision: Schema.Literals(["approve", "comment", "request_changes"]),
    body: Schema.optional(Schema.String),
  }),
  LabelsAction,
  AssigneesAction,
  ReviewersAction,
  Schema.Struct({ ...PullRequestTarget, kind: Schema.Literal("draft") }),
  Schema.Struct({ ...PullRequestTarget, kind: Schema.Literal("ready") }),
  Schema.Struct({
    ...PullRequestTarget,
    kind: Schema.Literal("merge"),
    strategy: Schema.Literals(["merge", "squash", "rebase"]),
    auto: Schema.optional(Schema.Boolean),
    disableAuto: Schema.optional(Schema.Boolean),
    deleteBranch: Schema.optional(Schema.Boolean),
    matchHeadCommit: Schema.optional(TrimmedNonEmptyString),
  }),
  Schema.Struct({
    ...PullRequestTarget,
    kind: Schema.Literal("close"),
    comment: Schema.optional(Schema.String),
    deleteBranch: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({ ...PullRequestTarget, kind: Schema.Literal("reopen") }),
  Schema.Struct({
    ...PullRequestTarget,
    kind: Schema.Literal("update_branch"),
    rebase: Schema.optional(Schema.Boolean),
  }),
]);
export type GitHubPullRequestAction = typeof GitHubPullRequestAction.Type;

export const GitHubPullRequestActionResult = Schema.Struct({
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
  kind: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
});
export type GitHubPullRequestActionResult = typeof GitHubPullRequestActionResult.Type;

export const GitHubPullRequestCheckoutInput = Schema.Struct({
  ...PullRequestTarget,
  cwd: TrimmedNonEmptyString,
  force: Schema.optional(Schema.Boolean),
});
export type GitHubPullRequestCheckoutInput = typeof GitHubPullRequestCheckoutInput.Type;

export const GitHubPullRequestCheckoutResult = Schema.Struct({
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
  cwd: TrimmedNonEmptyString,
});
export type GitHubPullRequestCheckoutResult = typeof GitHubPullRequestCheckoutResult.Type;

export class GitHubPullRequestError extends Schema.TaggedErrorClass<GitHubPullRequestError>()(
  "GitHubPullRequestError",
  {
    operation: TrimmedNonEmptyString,
    detail: TrimmedNonEmptyString,
    repository: Schema.optional(TrimmedNonEmptyString),
    number: Schema.optional(PositiveInt),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `GitHub pull request operation ${this.operation} failed: ${this.detail}`;
  }
}
