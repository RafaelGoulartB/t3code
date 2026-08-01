import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  TrimmedNonEmptyString,
  type GitHubPullRequestAction,
  type GitHubPullRequestActionResult,
  type GitHubPullRequestCheck,
  type GitHubPullRequestComment,
  type GitHubPullRequestChecksResult,
  type GitHubPullRequestDetails,
  type GitHubPullRequestDetailsInput,
  type GitHubPullRequestDiffResult,
  type GitHubPullRequestListInput,
  type GitHubPullRequestListResult,
  type GitHubPullRequestReviewThread,
  type SourceControlRepositoryVisibility,
  type VcsError,
} from "@t3tools/contracts";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import {
  decodeGitHubPullRequestJson,
  decodeGitHubPullRequestListJson,
} from "./gitHubPullRequests.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

const gitHubCliFailureFields = {
  command: Schema.Literal("gh"),
  cwd: Schema.String,
  cause: Schema.Defect(),
} as const;

export class GitHubCliUnavailableError extends Schema.TaggedErrorClass<GitHubCliUnavailableError>()(
  "GitHubCliUnavailableError",
  gitHubCliFailureFields,
) {
  get detail(): string {
    return "GitHub CLI (`gh`) is required but not available on PATH.";
  }

  override get message(): string {
    return `GitHub CLI failed in execute: ${this.detail}`;
  }
}

export class GitHubCliAuthenticationError extends Schema.TaggedErrorClass<GitHubCliAuthenticationError>()(
  "GitHubCliAuthenticationError",
  gitHubCliFailureFields,
) {
  get detail(): string {
    return "GitHub CLI is not authenticated. Run `gh auth login` and retry.";
  }

  override get message(): string {
    return `GitHub CLI failed in execute: ${this.detail}`;
  }
}

export class GitHubPullRequestNotFoundError extends Schema.TaggedErrorClass<GitHubPullRequestNotFoundError>()(
  "GitHubPullRequestNotFoundError",
  gitHubCliFailureFields,
) {
  get detail(): string {
    return "Pull request not found. Check the PR number or URL and try again.";
  }

  override get message(): string {
    return `GitHub CLI failed in execute: ${this.detail}`;
  }
}

export class GitHubCliCommandError extends Schema.TaggedErrorClass<GitHubCliCommandError>()(
  "GitHubCliCommandError",
  gitHubCliFailureFields,
) {
  get detail(): string {
    return "GitHub CLI command failed.";
  }

  override get message(): string {
    return `GitHub CLI failed in execute: ${this.detail}`;
  }
}

const gitHubCliDecodeFields = {
  command: Schema.Literal("gh"),
  cwd: Schema.String,
  cause: Schema.Defect(),
} as const;

export class GitHubPullRequestListDecodeError extends Schema.TaggedErrorClass<GitHubPullRequestListDecodeError>()(
  "GitHubPullRequestListDecodeError",
  gitHubCliDecodeFields,
) {
  get detail(): string {
    return "GitHub CLI returned invalid PR list JSON.";
  }

  override get message(): string {
    return `GitHub CLI failed in listOpenPullRequests: ${this.detail}`;
  }
}

export class GitHubChangeRequestListDecodeError extends Schema.TaggedErrorClass<GitHubChangeRequestListDecodeError>()(
  "GitHubChangeRequestListDecodeError",
  gitHubCliDecodeFields,
) {
  get detail(): string {
    return "GitHub CLI returned invalid change request JSON.";
  }

  override get message(): string {
    return `GitHub CLI failed in listChangeRequests: ${this.detail}`;
  }
}

export class GitHubPullRequestDecodeError extends Schema.TaggedErrorClass<GitHubPullRequestDecodeError>()(
  "GitHubPullRequestDecodeError",
  gitHubCliDecodeFields,
) {
  get detail(): string {
    return "GitHub CLI returned invalid pull request JSON.";
  }

  override get message(): string {
    return `GitHub CLI failed in getPullRequest: ${this.detail}`;
  }
}

export class GitHubRepositoryDecodeError extends Schema.TaggedErrorClass<GitHubRepositoryDecodeError>()(
  "GitHubRepositoryDecodeError",
  gitHubCliDecodeFields,
) {
  get detail(): string {
    return "GitHub CLI returned invalid repository JSON.";
  }

  override get message(): string {
    return `GitHub CLI failed in getRepositoryCloneUrls: ${this.detail}`;
  }
}

export const GitHubCliError = Schema.Union([
  GitHubCliUnavailableError,
  GitHubCliAuthenticationError,
  GitHubPullRequestNotFoundError,
  GitHubCliCommandError,
  GitHubPullRequestListDecodeError,
  GitHubChangeRequestListDecodeError,
  GitHubPullRequestDecodeError,
  GitHubRepositoryDecodeError,
]);
export type GitHubCliError = typeof GitHubCliError.Type;

export const isGitHubCliError = Schema.is(GitHubCliError);

export function fromVcsError(
  context: {
    readonly command: "gh";
    readonly cwd: string;
  },
  error: VcsError,
): GitHubCliError {
  if (
    error._tag === "VcsProcessSpawnError" &&
    error.cause instanceof PlatformError.PlatformError &&
    error.cause.reason._tag === "NotFound" &&
    error.cause.reason.module === "ChildProcess" &&
    error.cause.reason.method === "spawn"
  ) {
    return new GitHubCliUnavailableError({ ...context, cause: error });
  }

  if (error._tag === "VcsProcessExitError") {
    if (error.failureKind === "authentication") {
      return new GitHubCliAuthenticationError({ ...context, cause: error });
    }
    if (error.failureKind === "not-found") {
      return new GitHubPullRequestNotFoundError({ ...context, cause: error });
    }
  }

  return new GitHubCliCommandError({ ...context, cause: error });
}

export interface GitHubPullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state?: "open" | "closed" | "merged";
  readonly isCrossRepository?: boolean;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly headRepositoryOwnerLogin?: string | null;
}

export interface GitHubRepositoryCloneUrls {
  readonly nameWithOwner: string;
  readonly url: string;
  readonly sshUrl: string;
}

export class GitHubCli extends Context.Service<
  GitHubCli,
  {
    readonly execute: (input: {
      readonly cwd: string;
      readonly args: ReadonlyArray<string>;
      readonly timeoutMs?: number;
    }) => Effect.Effect<VcsProcess.VcsProcessOutput, GitHubCliError>;

    readonly listOpenPullRequests: (input: {
      readonly cwd: string;
      readonly headSelector: string;
      readonly limit?: number;
    }) => Effect.Effect<ReadonlyArray<GitHubPullRequestSummary>, GitHubCliError>;

    readonly getPullRequest: (input: {
      readonly cwd: string;
      readonly reference: string;
    }) => Effect.Effect<GitHubPullRequestSummary, GitHubCliError>;

    readonly getRepositoryCloneUrls: (input: {
      readonly cwd: string;
      readonly repository: string;
    }) => Effect.Effect<GitHubRepositoryCloneUrls, GitHubCliError>;

    readonly createRepository: (input: {
      readonly cwd: string;
      readonly repository: string;
      readonly visibility: SourceControlRepositoryVisibility;
    }) => Effect.Effect<GitHubRepositoryCloneUrls, GitHubCliError>;

    readonly createPullRequest: (input: {
      readonly cwd: string;
      readonly baseBranch: string;
      readonly headSelector: string;
      readonly title: string;
      readonly bodyFile: string;
    }) => Effect.Effect<void, GitHubCliError>;

    readonly getDefaultBranch: (input: {
      readonly cwd: string;
    }) => Effect.Effect<string | null, GitHubCliError>;

    readonly checkoutPullRequest: (input: {
      readonly cwd: string;
      readonly reference: string;
      readonly force?: boolean;
    }) => Effect.Effect<void, GitHubCliError>;

    readonly searchPullRequests: (input: {
      readonly cwd: string;
      readonly filters: GitHubPullRequestListInput;
    }) => Effect.Effect<GitHubPullRequestListResult, GitHubCliError>;

    readonly getPullRequestDetails: (input: {
      readonly cwd: string;
      readonly reference: GitHubPullRequestDetailsInput;
    }) => Effect.Effect<GitHubPullRequestDetails, GitHubCliError>;

    readonly getPullRequestChecks: (input: {
      readonly cwd: string;
      readonly reference: GitHubPullRequestDetailsInput;
    }) => Effect.Effect<GitHubPullRequestChecksResult, GitHubCliError>;

    readonly getPullRequestDiff: (input: {
      readonly cwd: string;
      readonly reference: GitHubPullRequestDetailsInput;
    }) => Effect.Effect<GitHubPullRequestDiffResult, GitHubCliError>;

    readonly runPullRequestAction: (input: {
      readonly cwd: string;
      readonly action: GitHubPullRequestAction;
    }) => Effect.Effect<GitHubPullRequestActionResult, GitHubCliError>;
  }
>()("t3/sourceControl/GitHubCli") {}

const RawGitHubRepositoryCloneUrlsSchema = Schema.Struct({
  nameWithOwner: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  sshUrl: TrimmedNonEmptyString,
});
const decodeRawGitHubRepositoryCloneUrls = Schema.decodeEffect(
  Schema.fromJsonString(RawGitHubRepositoryCloneUrlsSchema),
);

function normalizeRepositoryCloneUrls(
  raw: Schema.Schema.Type<typeof RawGitHubRepositoryCloneUrlsSchema>,
): GitHubRepositoryCloneUrls {
  return {
    nameWithOwner: raw.nameWithOwner,
    url: raw.url,
    sshUrl: raw.sshUrl,
  };
}

/**
 * `gh repo create` prints the canonical URL of the new repository on stdout
 * (e.g. `https://github.com/owner/repo`). Reading it back here avoids a
 * follow-up `gh repo view`, which can race GitHub's GraphQL eventual
 * consistency window and falsely report the just-created repo as missing.
 */
function deriveRepositoryCloneUrlsFromCreateOutput(
  stdout: string,
  repository: string,
): GitHubRepositoryCloneUrls {
  const fallbackHost = "github.com";
  const match = stdout.match(/https?:\/\/[^\s]+/);
  if (match) {
    const cleaned = match[0].replace(/\.git$/, "");
    try {
      const parsed = new URL(cleaned);
      const pathname = parsed.pathname.replace(/^\/+|\/+$/g, "");
      const segments = pathname.split("/").filter(Boolean);
      if (segments.length === 2) {
        const nameWithOwner = `${segments[0]}/${segments[1]}`;
        return {
          nameWithOwner,
          url: `${parsed.origin}/${nameWithOwner}`,
          sshUrl: `git@${parsed.host}:${nameWithOwner}.git`,
        };
      }
    } catch {
      // Fall through to the input-derived defaults below.
    }
  }
  return {
    nameWithOwner: repository,
    url: `https://${fallbackHost}/${repository}`,
    sshUrl: `git@${fallbackHost}:${repository}.git`,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function nullableStringValue(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

function actorValue(value: unknown): { login: string } | null {
  const login = stringValue(asRecord(value).login);
  return login ? { login } : null;
}

function actorValues(value: unknown): ReadonlyArray<{ login: string }> {
  return Array.isArray(value)
    ? value.map(actorValue).filter((actor): actor is { login: string } => actor !== null)
    : [];
}

function labelValues(value: unknown): ReadonlyArray<{ name: string; color?: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const record = asRecord(entry);
      const name = stringValue(record.name);
      if (!name) return null;
      const color = stringValue(record.color);
      return color ? { name, color } : { name };
    })
    .filter((label): label is { name: string; color?: string } => label !== null);
}

function commentValues(value: unknown): ReadonlyArray<GitHubPullRequestComment> {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const record = asRecord(entry);
    return {
      author: actorValue(record.author),
      body: typeof record.body === "string" ? record.body : "",
      createdAt: nullableStringValue(record.createdAt),
    };
  });
}

function reviewThreadValues(value: unknown): ReadonlyArray<GitHubPullRequestReviewThread> {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const record = asRecord(entry);
    const line = typeof record.line === "number" && record.line > 0 ? record.line : null;
    const originalLine =
      typeof record.originalLine === "number" && record.originalLine > 0
        ? record.originalLine
        : null;
    return {
      path: stringValue(record.path) ?? "unknown",
      line,
      originalLine,
      isResolved: record.isResolved === true,
      isOutdated: record.isOutdated === true,
      comments: commentValues(record.comments),
    };
  });
}

function pullRequestState(value: unknown, mergedAt: unknown): "open" | "closed" | "merged" {
  if (stringValue(mergedAt) || String(value ?? "").toUpperCase() === "MERGED") return "merged";
  return String(value ?? "OPEN").toUpperCase() === "CLOSED" ? "closed" : "open";
}

function checkValues(value: unknown): ReadonlyArray<GitHubPullRequestCheck> {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const record = asRecord(entry);
    const name = stringValue(record.name) ?? stringValue(record.context) ?? "Unnamed check";
    const state = stringValue(record.state) ?? "UNKNOWN";
    const bucket = stringValue(record.bucket) ?? state.toLowerCase();
    const description = stringValue(record.description) ?? "";
    const link = nullableStringValue(record.link ?? record.detailsUrl);
    const workflow = nullableStringValue(record.workflow ?? record.workflowName);
    return {
      name,
      state,
      bucket,
      description,
      link,
      workflow,
      startedAt: nullableStringValue(record.startedAt),
      completedAt: nullableStringValue(record.completedAt),
    } satisfies GitHubPullRequestCheck;
  });
}

function pullRequestCiStatus(
  value: unknown,
): "success" | "failure" | "pending" | "none" | "unknown" {
  if (value === undefined) return "unknown";
  const rollupState = stringValue(asRecord(value).state)?.toUpperCase();
  if (rollupState) {
    if (["FAILURE", "ERROR"].includes(rollupState)) return "failure";
    if (["PENDING", "EXPECTED"].includes(rollupState)) return "pending";
    if (["SUCCESS", "NEUTRAL", "SKIPPED", "STALE"].includes(rollupState)) return "success";
  }
  const checks = checkValues(value);
  if (checks.length === 0) return "none";

  let hasUnknown = false;
  let hasPending = false;
  for (const check of checks) {
    const bucket = check.bucket.toLowerCase();
    const state = check.state.toLowerCase();
    if (
      bucket.includes("fail") ||
      bucket.includes("error") ||
      bucket.includes("cancel") ||
      state.includes("fail") ||
      state.includes("error") ||
      state.includes("cancel")
    ) {
      return "failure";
    }
    if (
      bucket.includes("pending") ||
      bucket.includes("queue") ||
      bucket.includes("progress") ||
      state.includes("pending") ||
      state.includes("queue") ||
      state.includes("progress")
    ) {
      hasPending = true;
      continue;
    }
    if (
      !bucket.includes("pass") &&
      !bucket.includes("success") &&
      !bucket.includes("skip") &&
      !state.includes("success") &&
      !state.includes("complete")
    ) {
      hasUnknown = true;
    }
  }

  if (hasPending) return "pending";
  return hasUnknown ? "unknown" : "success";
}

function pullRequestReviewStatus(
  value: unknown,
): "approved" | "changes_requested" | "pending" | "none" | "unknown" {
  if (value === undefined) return "unknown";
  switch (
    String(value ?? "")
      .trim()
      .toUpperCase()
  ) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "REVIEW_REQUIRED":
      return "pending";
    case "":
      return "none";
    default:
      return "unknown";
  }
}

function pullRequestHasConflicts(raw: Record<string, unknown>): boolean {
  const mergeable = stringValue(raw.mergeable)?.trim().toUpperCase();
  const mergeStateStatus = stringValue(raw.mergeStateStatus)?.trim().toUpperCase();
  return mergeable === "CONFLICTING" || mergeStateStatus === "DIRTY";
}

function normalizeListResult(raw: unknown, limit: number): GitHubPullRequestListResult {
  const items = Array.isArray(raw)
    ? raw
        .map((entry) => {
          const record = asRecord(entry);
          const number = typeof record.number === "number" ? record.number : null;
          const title = stringValue(record.title);
          const url = stringValue(record.url);
          const repository = stringValue(asRecord(record.repository).nameWithOwner);
          if (!number || !title || !url || !repository) return null;
          return {
            number,
            title,
            url,
            repository,
            author: nullableStringValue(asRecord(record.author).login),
            state: pullRequestState(record.state, record.mergedAt),
            isDraft: record.isDraft === true,
            createdAt: nullableStringValue(record.createdAt),
            updatedAt: nullableStringValue(record.updatedAt),
            labels: labelValues(record.labels),
            ciStatus: pullRequestCiStatus(record.statusCheckRollup),
            reviewStatus: pullRequestReviewStatus(record.reviewDecision),
            hasConflicts: pullRequestHasConflicts(record),
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
    : [];
  return { items, limit, truncated: items.length >= limit };
}

const GRAPHQL_PULL_REQUEST_SEARCH_QUERY = `query($searchQuery: String!, $limit: Int!) {
  search(type: ISSUE, query: $searchQuery, first: $limit) {
    nodes {
      ... on PullRequest {
        number
        title
        url
        repository { nameWithOwner }
        author { login }
        state
        isDraft
        createdAt
        updatedAt
        labels(first: 20) { nodes { name color } }
        reviewDecision
        mergeable
        mergeStateStatus
        statusCheckRollup { state }
      }
    }
  }
}`;

const GRAPHQL_PULL_REQUEST_DETAILS_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      number
      title
      body
      url
      repository { nameWithOwner }
      author { login }
      state
      isDraft
      baseRefName
      headRefName
      createdAt
      updatedAt
      mergedAt
      additions
      deletions
      changedFiles
      reviewDecision
      mergeable
      mergeStateStatus
      labels(first: 100) { nodes { name color } }
      assignees(first: 100) { nodes { login } }
      reviewRequests(first: 100) {
        nodes {
          requestedReviewer {
            ... on User { login }
            ... on Team { name }
          }
        }
      }
      reviews(first: 100) {
        nodes { author { login } state body submittedAt }
      }
      reviewThreads(first: 100) {
        nodes {
          isResolved
          isOutdated
          path
          line
          originalLine
          comments(first: 100) {
            nodes { author { login } body createdAt }
          }
        }
      }
      comments(first: 100) {
        nodes { author { login } body createdAt }
      }
      statusCheckRollup {
        contexts(first: 100) {
          nodes {
            __typename
            ... on CheckRun {
              name
              status
              conclusion
              detailsUrl
              startedAt
              completedAt
            }
            ... on StatusContext {
              context
              state
              description
              targetUrl
              createdAt
              updatedAt
            }
          }
        }
      }
    }
  }
}`;

function quoteSearchQualifier(value: string): string {
  const trimmed = value.trim();
  return /\s/.test(trimmed) ? `"${trimmed.replaceAll('"', '\\"')}"` : trimmed;
}

function buildPullRequestTextQuery(query: string | undefined): string | undefined {
  const trimmed = query?.trim() ?? "";
  return trimmed.length > 0 ? `${trimmed} in:title` : undefined;
}

function buildPullRequestSearchQuery(filters: GitHubPullRequestListInput): string {
  const preset = filters.preset ?? "mine";
  const qualifiers: string[] = ["is:pr"];
  const textQuery = buildPullRequestTextQuery(filters.query);
  const state = filters.state ?? "open";
  if (state === "open" || state === "closed") qualifiers.push(`state:${state}`);
  if (state === "merged") qualifiers.push("is:merged");

  if (preset === "mine") qualifiers.push("author:@me");
  if (preset === "involvement") qualifiers.push("involves:@me");
  if (preset === "review_requested") qualifiers.push("user-review-requested:@me");
  if (preset === "checks_failed") qualifiers.push("author:@me", "status:failure");
  if (preset === "changes_requested") {
    qualifiers.push("author:@me", "review:changes_requested");
  }
  if (filters.organization) qualifiers.push(`org:${quoteSearchQualifier(filters.organization)}`);
  if (filters.organization && !filters.author && preset === "all") qualifiers.push("author:@me");
  if (filters.repository) qualifiers.push(`repo:${quoteSearchQualifier(filters.repository)}`);
  if (filters.author) qualifiers.push(`author:${quoteSearchQualifier(filters.author)}`);
  if (filters.reviewRequested) {
    qualifiers.push(`review-requested:${quoteSearchQualifier(filters.reviewRequested)}`);
  }
  if (filters.review) {
    qualifiers.push(`review:${filters.review === "required" ? "required" : filters.review}`);
  }
  if (filters.checks) qualifiers.push(`status:${filters.checks}`);
  if (filters.label) qualifiers.push(`label:${quoteSearchQualifier(filters.label)}`);
  if (filters.sort === "created" || filters.sort === "updated") {
    qualifiers.push(`sort:${filters.sort}-desc`);
  }

  return [textQuery, ...qualifiers].filter(Boolean).join(" ");
}

function normalizeGraphqlListResult(raw: unknown, limit: number): GitHubPullRequestListResult {
  const data = asRecord(asRecord(raw).data);
  const search = asRecord(data.search);
  if (!Array.isArray(search.nodes)) {
    throw new Error("GitHub GraphQL search returned no pull request nodes.");
  }
  const nodes = search.nodes;
  const normalizedNodes = nodes.map((node) => {
    const record = asRecord(node);
    const labels = asRecord(record.labels);
    return {
      ...record,
      labels: Array.isArray(labels.nodes) ? labels.nodes : [],
    };
  });
  return normalizeListResult(normalizedNodes, limit);
}

function normalizeGraphqlDetails(raw: unknown, repository: string): GitHubPullRequestDetails {
  const data = asRecord(asRecord(raw).data);
  const repositoryRecord = asRecord(data.repository);
  const pullRequest = asRecord(repositoryRecord.pullRequest);
  if (Object.keys(pullRequest).length === 0) {
    throw new Error("GitHub GraphQL returned no pull request details.");
  }

  const labels = asRecord(pullRequest.labels);
  const assignees = asRecord(pullRequest.assignees);
  const reviewRequests = asRecord(pullRequest.reviewRequests);
  const reviews = asRecord(pullRequest.reviews);
  const reviewThreads = asRecord(pullRequest.reviewThreads);
  const comments = asRecord(pullRequest.comments);
  const rollup = asRecord(pullRequest.statusCheckRollup);
  const contexts = asRecord(rollup.contexts);
  const checks = (Array.isArray(contexts.nodes) ? contexts.nodes : []).map((entry) => {
    const check = asRecord(entry);
    const type = stringValue(check.__typename);
    const state = stringValue(check.conclusion ?? check.status ?? check.state) ?? "UNKNOWN";
    const normalizedState = state.toUpperCase();
    const bucket = ["FAILURE", "ERROR", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(
      normalizedState,
    )
      ? "fail"
      : ["PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"].includes(
            normalizedState,
          )
        ? "pending"
        : ["SKIPPED"].includes(normalizedState)
          ? "skipping"
          : ["CANCELLED"].includes(normalizedState)
            ? "cancel"
            : "pass";
    return {
      name: stringValue(check.name) ?? stringValue(check.context) ?? type ?? "Unnamed check",
      state,
      bucket,
      description: stringValue(check.description) ?? "",
      link: nullableStringValue(check.detailsUrl ?? check.targetUrl),
      workflow: nullableStringValue(check.workflowName),
      startedAt: nullableStringValue(check.startedAt ?? check.createdAt),
      completedAt: nullableStringValue(check.completedAt ?? check.updatedAt),
    } satisfies GitHubPullRequestCheck;
  });

  return normalizeDetails(
    {
      ...pullRequest,
      labels: Array.isArray(labels.nodes) ? labels.nodes : [],
      assignees: Array.isArray(assignees.nodes) ? assignees.nodes : [],
      reviewRequests: (Array.isArray(reviewRequests.nodes) ? reviewRequests.nodes : [])
        .map((entry) => asRecord(asRecord(entry).requestedReviewer))
        .filter((entry) => Object.keys(entry).length > 0),
      reviews: Array.isArray(reviews.nodes) ? reviews.nodes : [],
      reviewThreads: Array.isArray(reviewThreads.nodes)
        ? reviewThreads.nodes.map((entry) => {
            const thread = asRecord(entry);
            const threadComments = asRecord(thread.comments);
            return {
              ...thread,
              comments: Array.isArray(threadComments.nodes) ? threadComments.nodes : [],
            };
          })
        : [],
      comments: Array.isArray(comments.nodes) ? comments.nodes : [],
      statusCheckRollup: checks,
    },
    repository,
  );
}

function normalizeDetails(raw: unknown, repository: string): GitHubPullRequestDetails {
  const record = asRecord(raw);
  const number = typeof record.number === "number" ? record.number : 0;
  return {
    number,
    title: stringValue(record.title) ?? "Untitled pull request",
    body: typeof record.body === "string" ? record.body : "",
    url: stringValue(record.url) ?? `https://github.com/${repository}/pull/${number}`,
    repository,
    author: actorValue(record.author),
    state: pullRequestState(record.state, record.mergedAt),
    isDraft: record.isDraft === true,
    baseRefName: stringValue(record.baseRefName) ?? "unknown",
    headRefName: stringValue(record.headRefName) ?? "unknown",
    createdAt: nullableStringValue(record.createdAt),
    updatedAt: nullableStringValue(record.updatedAt),
    mergedAt: nullableStringValue(record.mergedAt),
    additions: typeof record.additions === "number" ? record.additions : 0,
    deletions: typeof record.deletions === "number" ? record.deletions : 0,
    changedFiles: typeof record.changedFiles === "number" ? record.changedFiles : 0,
    reviewDecision: nullableStringValue(record.reviewDecision),
    mergeable: nullableStringValue(record.mergeable),
    mergeStateStatus: nullableStringValue(record.mergeStateStatus),
    hasConflicts: pullRequestHasConflicts(record),
    labels: labelValues(record.labels),
    assignees: actorValues(record.assignees),
    reviewRequests: actorValues(record.reviewRequests),
    reviews: Array.isArray(record.reviews)
      ? record.reviews.map((entry) => {
          const value = asRecord(entry);
          return {
            author: actorValue(value.author),
            state: stringValue(value.state) ?? "UNKNOWN",
            body: typeof value.body === "string" ? value.body : "",
            submittedAt: nullableStringValue(value.submittedAt),
          };
        })
      : [],
    comments: commentValues(record.comments),
    reviewThreads: reviewThreadValues(record.reviewThreads),
    checks: checkValues(record.statusCheckRollup),
  };
}

function jsonOutput(raw: string): unknown {
  return JSON.parse(raw) as unknown;
}

function targetArgs(repository: string, number: number): string[] {
  return [String(number), "--repo", repository];
}

function actionArgs(action: GitHubPullRequestAction): string[] {
  const target = targetArgs(action.repository, action.number);
  switch (action.kind) {
    case "edit":
      return [
        "pr",
        "edit",
        ...target,
        ...(action.title !== undefined ? ["--title", action.title] : []),
        ...(action.body !== undefined ? ["--body", action.body] : []),
      ];
    case "comment":
      return ["pr", "comment", ...target, "--body", action.body];
    case "review":
      return [
        "pr",
        "review",
        ...target,
        action.decision === "approve"
          ? "--approve"
          : action.decision === "request_changes"
            ? "--request-changes"
            : "--comment",
        ...(action.body !== undefined ? ["--body", action.body] : []),
      ];
    case "labels":
      return [
        "pr",
        "edit",
        ...target,
        ...(action.add?.flatMap((value) => ["--add-label", value]) ?? []),
        ...(action.remove?.flatMap((value) => ["--remove-label", value]) ?? []),
      ];
    case "assignees":
      return [
        "pr",
        "edit",
        ...target,
        ...(action.add?.flatMap((value) => ["--add-assignee", value]) ?? []),
        ...(action.remove?.flatMap((value) => ["--remove-assignee", value]) ?? []),
      ];
    case "reviewers":
      return [
        "pr",
        "edit",
        ...target,
        ...(action.add?.flatMap((value) => ["--add-reviewer", value]) ?? []),
        ...(action.remove?.flatMap((value) => ["--remove-reviewer", value]) ?? []),
      ];
    case "draft":
      return ["pr", "ready", ...target, "--undo"];
    case "ready":
      return ["pr", "ready", ...target];
    case "merge":
      return [
        "pr",
        "merge",
        ...target,
        `--${action.strategy}`,
        ...(action.auto ? ["--auto"] : []),
        ...(action.disableAuto ? ["--disable-auto"] : []),
        ...(action.deleteBranch ? ["--delete-branch"] : []),
        ...(action.matchHeadCommit ? ["--match-head-commit", action.matchHeadCommit] : []),
      ];
    case "close":
      return [
        "pr",
        "close",
        ...target,
        ...(action.comment !== undefined ? ["--comment", action.comment] : []),
        ...(action.deleteBranch ? ["--delete-branch"] : []),
      ];
    case "reopen":
      return ["pr", "reopen", ...target];
    case "update_branch":
      return ["pr", "update-branch", ...target, ...(action.rebase ? ["--rebase"] : [])];
  }
}

export const make = Effect.gen(function* () {
  const process = yield* VcsProcess.VcsProcess;

  const execute: GitHubCli["Service"]["execute"] = (input) =>
    process
      .run({
        operation: "GitHubCli.execute",
        command: "gh",
        args: input.args,
        cwd: input.cwd,
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      })
      .pipe(Effect.mapError((error) => fromVcsError({ command: "gh", cwd: input.cwd }, error)));

  return GitHubCli.of({
    execute,
    searchPullRequests: (input) => {
      const filters = input.filters;
      const limit = filters.limit ?? 50;
      const state = filters.state ?? "open";
      const textQuery = buildPullRequestTextQuery(filters.query);
      const basicArgs = [
        "search",
        "prs",
        ...(textQuery ? [textQuery] : []),
        ...(state === "open" || state === "closed" ? ["--state", state] : []),
        ...(state === "merged" ? ["--merged"] : []),
        "--limit",
        String(limit),
        "--sort",
        filters.sort ?? "updated",
        "--json",
        "number,title,url,author,repository,state,createdAt,updatedAt,isDraft,labels",
      ];
      const preset = filters.preset ?? "mine";
      if (preset === "mine") basicArgs.push("--author", "@me");
      if (preset === "involvement") basicArgs.push("--involves", "@me");
      if (preset === "review_requested") basicArgs.push("--review-requested", "@me");
      if (preset === "checks_failed") basicArgs.push("--author", "@me", "--checks", "failure");
      if (preset === "changes_requested") {
        basicArgs.push("--author", "@me", "--review", "changes_requested");
      }
      if (filters.organization) basicArgs.push("--owner", filters.organization);
      if (filters.organization && !filters.author && preset === "all") {
        basicArgs.push("--author", "@me");
      }
      if (filters.repository) basicArgs.push("--repo", filters.repository);
      if (filters.author) basicArgs.push("--author", filters.author);
      if (filters.reviewRequested) basicArgs.push("--review-requested", filters.reviewRequested);
      if (filters.review) basicArgs.push("--review", filters.review);
      if (filters.checks) basicArgs.push("--checks", filters.checks);
      if (filters.label) basicArgs.push("--label", filters.label);

      const parseResult = (
        raw: string,
        normalize: (value: unknown) => GitHubPullRequestListResult,
      ) =>
        Effect.try({
          try: () => normalize(jsonOutput(raw)),
          catch: (cause) =>
            new GitHubPullRequestListDecodeError({ command: "gh", cwd: input.cwd, cause }),
        });
      const graphqlSearch = execute({
        cwd: input.cwd,
        args: [
          "api",
          "graphql",
          "-f",
          `query=${GRAPHQL_PULL_REQUEST_SEARCH_QUERY}`,
          "-f",
          `searchQuery=${buildPullRequestSearchQuery(filters)}`,
          "-F",
          `limit=${limit}`,
        ],
      }).pipe(
        Effect.flatMap((result) =>
          parseResult(result.stdout.trim(), (value) => normalizeGraphqlListResult(value, limit)),
        ),
      );
      const basicSearch = Effect.suspend(() =>
        execute({ cwd: input.cwd, args: basicArgs }).pipe(
          Effect.flatMap((result) =>
            parseResult(result.stdout.trim(), (value) => normalizeListResult(value, limit)),
          ),
        ),
      );
      return graphqlSearch.pipe(Effect.catch(() => basicSearch));
    },
    getPullRequestDetails: (input) => {
      const [owner, ...repositoryParts] = input.reference.repository.split("/");
      const repo = repositoryParts.join("/");
      return execute({
        cwd: input.cwd,
        args: [
          "api",
          "graphql",
          "-f",
          `query=${GRAPHQL_PULL_REQUEST_DETAILS_QUERY}`,
          "-f",
          `owner=${owner ?? ""}`,
          "-f",
          `repo=${repo}`,
          "-F",
          `number=${input.reference.number}`,
        ],
      }).pipe(
        Effect.flatMap((result) =>
          Effect.try({
            try: () =>
              normalizeGraphqlDetails(jsonOutput(result.stdout.trim()), input.reference.repository),
            catch: (cause) =>
              new GitHubPullRequestDecodeError({ command: "gh", cwd: input.cwd, cause }),
          }),
        ),
      );
    },
    getPullRequestChecks: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "checks",
          ...targetArgs(input.reference.repository, input.reference.number),
          "--json",
          "name,state,bucket,description,link,workflow,startedAt,completedAt",
        ],
      }).pipe(
        Effect.flatMap((result) =>
          Effect.try({
            try: () =>
              ({
                repository: input.reference.repository,
                number: input.reference.number,
                checks: checkValues(jsonOutput(result.stdout.trim())),
              }) satisfies GitHubPullRequestChecksResult,
            catch: (cause) =>
              new GitHubPullRequestDecodeError({ command: "gh", cwd: input.cwd, cause }),
          }),
        ),
      ),
    getPullRequestDiff: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "diff",
          ...targetArgs(input.reference.repository, input.reference.number),
          "--color",
          "never",
        ],
      }).pipe(
        Effect.map(
          (result) =>
            ({
              repository: input.reference.repository,
              number: input.reference.number,
              diff: result.stdout,
              truncated: result.stdoutTruncated,
            }) satisfies GitHubPullRequestDiffResult,
        ),
      ),
    runPullRequestAction: (input) =>
      execute({ cwd: input.cwd, args: actionArgs(input.action) }).pipe(
        Effect.map(
          () =>
            ({
              repository: input.action.repository,
              number: input.action.number,
              kind: input.action.kind,
              message: `Pull request action ${input.action.kind} completed.`,
            }) satisfies GitHubPullRequestActionResult,
        ),
      ),
    listOpenPullRequests: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "list",
          "--head",
          input.headSelector,
          "--state",
          "open",
          "--limit",
          String(input.limit ?? 1),
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner",
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed([])
            : Effect.sync(() => decodeGitHubPullRequestListJson(raw)).pipe(
                Effect.flatMap((decoded) => {
                  if (!Result.isSuccess(decoded)) {
                    return Effect.fail(
                      new GitHubPullRequestListDecodeError({
                        command: "gh",
                        cwd: input.cwd,
                        cause: decoded.failure,
                      }),
                    );
                  }

                  return Effect.succeed(
                    decoded.success.map(({ updatedAt: _updatedAt, ...summary }) => summary),
                  );
                }),
              ),
        ),
      ),
    getPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "view",
          input.reference,
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner",
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          Effect.sync(() => decodeGitHubPullRequestJson(raw)).pipe(
            Effect.flatMap((decoded) => {
              if (!Result.isSuccess(decoded)) {
                return Effect.fail(
                  new GitHubPullRequestDecodeError({
                    command: "gh",
                    cwd: input.cwd,
                    cause: decoded.failure,
                  }),
                );
              }

              return Effect.succeed(
                (({ updatedAt: _updatedAt, ...summary }) => summary)(decoded.success),
              );
            }),
          ),
        ),
      ),
    getRepositoryCloneUrls: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", input.repository, "--json", "nameWithOwner,url,sshUrl"],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeRawGitHubRepositoryCloneUrls(raw).pipe(
            Effect.mapError(
              (cause) =>
                new GitHubRepositoryDecodeError({
                  command: "gh",
                  cwd: input.cwd,
                  cause,
                }),
            ),
          ),
        ),
        Effect.map(normalizeRepositoryCloneUrls),
      ),
    createRepository: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "create", input.repository, `--${input.visibility}`],
      }).pipe(
        Effect.map((result) =>
          deriveRepositoryCloneUrlsFromCreateOutput(result.stdout, input.repository),
        ),
      ),
    createPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "create",
          "--base",
          input.baseBranch,
          "--head",
          input.headSelector,
          "--title",
          input.title,
          "--body-file",
          input.bodyFile,
        ],
      }).pipe(Effect.asVoid),
    getDefaultBranch: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
      }).pipe(
        Effect.map((value) => {
          const trimmed = value.stdout.trim();
          return trimmed.length > 0 ? trimmed : null;
        }),
      ),
    checkoutPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "checkout", input.reference, ...(input.force ? ["--force"] : [])],
      }).pipe(Effect.asVoid),
  });
});

export const layer = Layer.effect(GitHubCli, make);
