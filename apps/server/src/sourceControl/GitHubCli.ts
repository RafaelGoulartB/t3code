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
  type GitHubPullRequestChecksResult,
  type GitHubPullRequestDetails,
  type GitHubPullRequestDetailsInput,
  type GitHubPullRequestDiffResult,
  type GitHubPullRequestListInput,
  type GitHubPullRequestListResult,
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
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
    : [];
  return { items, limit, truncated: items.length >= limit };
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
    comments: Array.isArray(record.comments)
      ? record.comments.map((entry) => {
          const value = asRecord(entry);
          return {
            author: actorValue(value.author),
            body: typeof value.body === "string" ? value.body : "",
            createdAt: nullableStringValue(value.createdAt),
          };
        })
      : [],
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
      const args = [
        "search",
        "prs",
        ...(filters.query && filters.query.trim().length > 0 ? [filters.query.trim()] : []),
        ...(state === "open" || state === "closed" ? ["--state", state] : []),
        ...(state === "merged" ? ["--merged"] : []),
        "--limit",
        String(limit),
        "--sort",
        filters.sort ?? "updated",
        "--json",
        "number,title,url,author,repository,state,createdAt,updatedAt,isDraft,labels",
      ];
      const preset = filters.preset ?? "all";
      if (preset === "mine") args.push("--author", "@me");
      if (preset === "review_requested") args.push("--review-requested", "@me");
      if (preset === "checks_failed") args.push("--checks", "failure");
      if (preset === "changes_requested") {
        args.push("--author", "@me", "--review", "changes_requested");
      }
      if (filters.organization) args.push("--owner", filters.organization);
      if (filters.repository) args.push("--repo", filters.repository);
      if (filters.author) args.push("--author", filters.author);
      if (filters.reviewRequested) args.push("--review-requested", filters.reviewRequested);
      if (filters.review) args.push("--review", filters.review);
      if (filters.checks) args.push("--checks", filters.checks);
      if (filters.label) args.push("--label", filters.label);

      return execute({ cwd: input.cwd, args }).pipe(
        Effect.flatMap((result) =>
          Effect.try({
            try: () => normalizeListResult(jsonOutput(result.stdout.trim()), limit),
            catch: (cause) =>
              new GitHubPullRequestListDecodeError({ command: "gh", cwd: input.cwd, cause }),
          }),
        ),
      );
    },
    getPullRequestDetails: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "view",
          ...targetArgs(input.reference.repository, input.reference.number),
          "--json",
          "number,title,body,url,repository,author,state,isDraft,baseRefName,headRefName,createdAt,updatedAt,mergedAt,additions,deletions,changedFiles,reviewDecision,mergeable,mergeStateStatus,labels,assignees,reviewRequests,reviews,comments,statusCheckRollup",
        ],
      }).pipe(
        Effect.flatMap((result) =>
          Effect.try({
            try: () =>
              normalizeDetails(jsonOutput(result.stdout.trim()), input.reference.repository),
            catch: (cause) =>
              new GitHubPullRequestDecodeError({ command: "gh", cwd: input.cwd, cause }),
          }),
        ),
      ),
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
