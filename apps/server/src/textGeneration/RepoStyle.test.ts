// @effect-diagnostics nodeBuiltinImport:off - Test exercises the default git invoker
// path which shells out via node:child_process to a real git binary.
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { fetchRecentCommitSubjects, type GitLogInvoker } from "./RepoStyle.ts";

it.effect("fetchRecentCommitSubjects returns an empty list when the invoker fails", () =>
  Effect.gen(function* () {
    const fakeInvoker: GitLogInvoker = () => ({
      stdout: "",
      stderr: "fatal: not a git repository",
      status: 128,
    });
    const result = yield* Effect.orElseSucceed(
      fetchRecentCommitSubjects("/tmp/whatever", { invoker: fakeInvoker }),
      () => [] as ReadonlyArray<string>,
    );
    expect(result).toEqual([]);
  }),
);

it.effect("fetchRecentCommitSubjects ignores blank lines and dedupes repeated subjects", () =>
  Effect.gen(function* () {
    const fakeInvoker: GitLogInvoker = () => ({
      stdout: "feat: a\n\n\nfeat: b\n   \nfeat: a\n",
      stderr: "",
      status: 0,
    });
    const result = yield* fetchRecentCommitSubjects("/tmp/whatever", {
      invoker: fakeInvoker,
    });
    expect(result).toEqual(["feat: a", "feat: b"]);
  }),
);

it.effect("fetchRecentCommitSubjects truncates very long subjects", () =>
  Effect.gen(function* () {
    const longSubject = `feat: ${"x".repeat(500)}`;
    const fakeInvoker: GitLogInvoker = () => ({
      stdout: `${longSubject}\nshort\n`,
      stderr: "",
      status: 0,
    });
    const result = yield* fetchRecentCommitSubjects("/tmp/whatever", {
      invoker: fakeInvoker,
    });
    expect(result[0]?.length).toBeLessThanOrEqual(200);
    expect(result[0]?.endsWith("…")).toBe(true);
    expect(result[1]).toBe("short");
  }),
);

it.effect("fetchRecentCommitSubjects respects the limit option", () =>
  Effect.gen(function* () {
    const subjects = Array.from({ length: 5 }, (_, i) => `commit ${i}`).join("\n");
    const fakeInvoker: GitLogInvoker = () => ({
      stdout: subjects,
      stderr: "",
      status: 0,
    });
    const result = yield* fetchRecentCommitSubjects("/tmp/whatever", {
      invoker: fakeInvoker,
      limit: 3,
    });
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("commit 0");
    expect(result[1]).toBe("commit 1");
    expect(result[2]).toBe("commit 2");
  }),
);
