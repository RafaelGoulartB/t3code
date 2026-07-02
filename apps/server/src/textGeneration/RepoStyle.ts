// @effect-diagnostics nodeBuiltinImport:off - Wraps `git log` and intentionally
// captures the exec-sync result shape for soft-failure handling.
/**
 * RepoStyle - Read recent commit subjects from a repository's git log
 * to use as style references for text generation.
 *
 * Used by the `repo_conventions` text-generation preset. The function is
 * designed to fail soft: a non-git directory, a fresh repo with no commits,
 * or a missing `git` binary should all yield an empty list rather than
 * raise, so non-git threads keep working with the default-style prompt.
 */
import * as Effect from "effect/Effect";
import { TextGenerationError } from "@t3tools/contracts";
import * as NodeChildProcess from "node:child_process";

export const DEFAULT_RECENT_COMMIT_LIMIT = 30;
const MAX_SUBJECT_LENGTH = 200;

export type GitLogInvoker = (
  cwd: string,
  args: ReadonlyArray<string>,
) => { stdout: string; stderr: string; status: number };

const defaultGitLogInvoker: GitLogInvoker = (cwd, args) => {
  try {
    const stdout = NodeChildProcess.execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 * 1024,
    });
    return { stdout, stderr: "", status: 0 };
  } catch (error) {
    const execError = error as NodeChildProcess.ExecException & {
      stdout?: string | Buffer | undefined;
      stderr?: string | Buffer | undefined;
    };
    return {
      stdout: typeof execError.stdout === "string" ? execError.stdout : "",
      stderr: typeof execError.stderr === "string" ? execError.stderr : "",
      status: typeof execError.code === "number" ? execError.code : -1,
    };
  }
};

export interface FetchRecentCommitSubjectsOptions {
  readonly limit?: number | undefined;
  readonly invoker?: GitLogInvoker | undefined;
}

function parseAndDedupe(stdout: string, limit: number): ReadonlyArray<string> {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.replace(/\r$/, "").trim();
    if (trimmed.length === 0) continue;
    const truncated =
      trimmed.length > MAX_SUBJECT_LENGTH
        ? `${trimmed.slice(0, MAX_SUBJECT_LENGTH - 1)}…`
        : trimmed;
    if (seen.has(truncated)) continue;
    seen.add(truncated);
    result.push(truncated);
    if (result.length >= limit) break;
  }
  return result;
}

export function fetchRecentCommitSubjects(
  cwd: string,
  options: FetchRecentCommitSubjectsOptions = {},
): Effect.Effect<ReadonlyArray<string>, TextGenerationError> {
  const limit = options.limit ?? DEFAULT_RECENT_COMMIT_LIMIT;
  const invoker = options.invoker ?? defaultGitLogInvoker;
  const result = invoker(cwd, ["log", `-n${limit}`, "--pretty=format:%s", "--no-merges"]);
  if (result.status !== 0) {
    return Effect.succeed([]);
  }
  return Effect.succeed(parseAndDedupe(result.stdout, limit));
}
