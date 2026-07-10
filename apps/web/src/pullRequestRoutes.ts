import type {
  GitHubPullRequestChecksFilter,
  GitHubPullRequestListInput,
  GitHubPullRequestPreset,
  GitHubPullRequestReviewFilter,
  GitHubPullRequestSort,
  GitHubPullRequestStateFilter,
} from "@t3tools/contracts";

export interface PullRequestSearch {
  readonly environment?: string;
  readonly preset?: GitHubPullRequestPreset;
  readonly state?: GitHubPullRequestStateFilter;
  readonly organization?: string;
  readonly repository?: string;
  readonly author?: string;
  readonly reviewRequested?: string;
  readonly review?: GitHubPullRequestReviewFilter;
  readonly checks?: GitHubPullRequestChecksFilter;
  readonly label?: string;
  readonly query?: string;
  readonly sort?: GitHubPullRequestSort;
  readonly limit?: number;
}

export interface ResolvedPullRequestSearch {
  readonly environment?: string;
  readonly preset: GitHubPullRequestPreset;
  readonly state: GitHubPullRequestStateFilter;
  readonly organization?: string;
  readonly repository?: string;
  readonly author?: string;
  readonly reviewRequested?: string;
  readonly review?: GitHubPullRequestReviewFilter;
  readonly checks?: GitHubPullRequestChecksFilter;
  readonly label?: string;
  readonly query?: string;
  readonly sort: GitHubPullRequestSort;
  readonly limit: number;
}

const presets = new Set<GitHubPullRequestPreset>([
  "mine",
  "involvement",
  "review_requested",
  "checks_failed",
  "changes_requested",
  "all",
]);
const states = new Set<GitHubPullRequestStateFilter>(["open", "closed", "merged", "all"]);
const reviews = new Set<GitHubPullRequestReviewFilter>([
  "none",
  "required",
  "approved",
  "changes_requested",
]);
const checks = new Set<GitHubPullRequestChecksFilter>(["pending", "success", "failure"]);
const sorts = new Set<GitHubPullRequestSort>(["best-match", "created", "updated"]);

function stringParam(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function enumParam<T extends string>(value: unknown, allowed: ReadonlySet<T>, fallback: T): T {
  return typeof value === "string" && allowed.has(value as T) ? (value as T) : fallback;
}

export function parsePullRequestSearch(input: Record<string, unknown>): PullRequestSearch {
  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.min(100, Math.max(10, Math.round(input.limit)))
      : 50;
  const environment = stringParam(input.environment);
  const organization = stringParam(input.organization);
  const repository = stringParam(input.repository);
  const author = stringParam(input.author);
  const reviewRequested = stringParam(input.reviewRequested);
  const label = stringParam(input.label);
  const query = stringParam(input.query);
  const review =
    typeof input.review === "string" && reviews.has(input.review as GitHubPullRequestReviewFilter)
      ? (input.review as GitHubPullRequestReviewFilter)
      : undefined;
  const checksFilter =
    typeof input.checks === "string" && checks.has(input.checks as GitHubPullRequestChecksFilter)
      ? (input.checks as GitHubPullRequestChecksFilter)
      : undefined;
  return {
    preset: enumParam(input.preset, presets, "mine"),
    state: enumParam(input.state, states, "open"),
    sort: enumParam(input.sort, sorts, "updated"),
    limit,
    ...(environment ? { environment } : {}),
    ...(organization ? { organization } : {}),
    ...(repository ? { repository } : {}),
    ...(author ? { author } : {}),
    ...(reviewRequested ? { reviewRequested } : {}),
    ...(review ? { review } : {}),
    ...(checksFilter ? { checks: checksFilter } : {}),
    ...(label ? { label } : {}),
    ...(query ? { query } : {}),
  };
}

export function resolvePullRequestSearch(search: PullRequestSearch): ResolvedPullRequestSearch {
  return {
    ...search,
    preset: search.preset ?? "mine",
    state: search.state ?? "open",
    sort: search.sort ?? "updated",
    limit: search.limit ?? 50,
  };
}

export function pullRequestSearchToInput(search: PullRequestSearch): GitHubPullRequestListInput {
  const resolved = resolvePullRequestSearch(search);
  return {
    preset: resolved.preset,
    state: resolved.state,
    ...(resolved.organization ? { organization: resolved.organization } : {}),
    ...(resolved.repository ? { repository: resolved.repository } : {}),
    ...(resolved.author ? { author: resolved.author } : {}),
    ...(resolved.reviewRequested ? { reviewRequested: resolved.reviewRequested } : {}),
    ...(resolved.review ? { review: resolved.review } : {}),
    ...(resolved.checks ? { checks: resolved.checks } : {}),
    ...(resolved.label ? { label: resolved.label } : {}),
    ...(resolved.query ? { query: resolved.query } : {}),
    sort: resolved.sort,
    limit: resolved.limit,
  };
}

export function clearPullRequestFilters(search: PullRequestSearch): PullRequestSearch {
  return {
    ...search,
    preset: "mine",
    state: "open",
  };
}
