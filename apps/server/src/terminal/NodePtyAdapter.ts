// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
// node-pty's console-list helper communicates through Node's fork IPC API;
// Effect's ChildProcess abstraction intentionally does not expose IPC.
import * as NodeChildProcess from "node:child_process";
import * as NodeModule from "node:module";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HostProcessArchitecture, HostProcessPlatform } from "@t3tools/shared/hostProcess";

import * as PtyAdapter from "./PtyAdapter.ts";

export class NodePtyModuleLoadError extends Schema.TaggedErrorClass<NodePtyModuleLoadError>()(
  "NodePtyModuleLoadError",
  {
    platform: Schema.String,
    architecture: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to load node-pty for ${this.platform}-${this.architecture}.`;
  }
}

type NodePtyModuleLoader = () => Promise<typeof import("node-pty")>;

const requireForNodePty = NodeModule.createRequire(import.meta.url);

function resolveConsoleProcessListAgentPath(): string | null {
  try {
    // Shipped by node-pty: it uses GetConsoleProcessList, not WMI.
    return requireForNodePty.resolve("node-pty/lib/conpty_console_list_agent.js");
  } catch {
    return null;
  }
}

function normalizeProcessIds(value: unknown, fallbackPid: number): ReadonlyArray<number> {
  const ids = Array.isArray(value)
    ? value.filter((pid): pid is number => Number.isInteger(pid) && pid > 0)
    : [];
  return ids.length > 0 ? [...new Set(ids)] : [fallbackPid];
}

let didEnsureSpawnHelperExecutable = false;

const resolveNodePtySpawnHelperPath = Effect.gen(function* () {
  const requireForNodePty = NodeModule.createRequire(import.meta.url);
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const platform = yield* HostProcessPlatform;
  const architecture = yield* HostProcessArchitecture;

  const packageJsonPath = requireForNodePty.resolve("node-pty/package.json");
  const packageDir = path.dirname(packageJsonPath);
  const candidates = [
    path.join(packageDir, "build", "Release", "spawn-helper"),
    path.join(packageDir, "build", "Debug", "spawn-helper"),
    path.join(packageDir, "prebuilds", `${platform}-${architecture}`, "spawn-helper"),
  ];

  for (const candidate of candidates) {
    if (yield* fs.exists(candidate)) {
      return candidate;
    }
  }
  return null;
}).pipe(Effect.orElseSucceed(() => null));

const ensureNodePtySpawnHelperExecutable = Effect.fn(function* () {
  const fs = yield* FileSystem.FileSystem;
  const platform = yield* HostProcessPlatform;
  if (platform === "win32") return;
  if (didEnsureSpawnHelperExecutable) return;

  const helperPath = yield* resolveNodePtySpawnHelperPath;
  if (!helperPath) return;
  didEnsureSpawnHelperExecutable = true;

  if (!(yield* fs.exists(helperPath))) {
    return;
  }

  // Best-effort: avoid FileSystem.stat in packaged mode where some fs metadata can be missing.
  yield* fs.chmod(helperPath, 0o755).pipe(Effect.orElseSucceed(() => undefined));
});

class NodePtyProcess implements PtyAdapter.PtyProcess {
  private readonly process: import("node-pty").IPty;
  private readonly consoleProcessListAgentPath: string | null;
  private readonly isWindows: boolean;

  constructor(
    process: import("node-pty").IPty,
    consoleProcessListAgentPath: string | null,
    isWindows: boolean,
  ) {
    this.process = process;
    this.consoleProcessListAgentPath = consoleProcessListAgentPath;
    this.isWindows = isWindows;
  }

  get pid(): number {
    return this.process.pid;
  }

  getProcessIds(): Promise<ReadonlyArray<number>> {
    if (!this.isWindows || this.consoleProcessListAgentPath === null) {
      return Promise.resolve([this.pid]);
    }

    return new Promise((resolve) => {
      const child = NodeChildProcess.fork(this.consoleProcessListAgentPath!, [String(this.pid)], {
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      let settled = false;
      const finish = (value: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(normalizeProcessIds(value, this.pid));
      };
      const timeout = setTimeout(() => {
        child.kill();
        finish([]);
      }, 1_000);
      child.once("message", (message) => {
        const processIds =
          typeof message === "object" && message !== null && "consoleProcessList" in message
            ? (message as { readonly consoleProcessList: unknown }).consoleProcessList
            : [];
        finish(processIds);
      });
      child.once("error", () => finish([]));
      child.once("exit", () => finish([]));
    });
  }

  write(data: string): void {
    this.process.write(data);
  }

  resize(cols: number, rows: number): void {
    this.process.resize(cols, rows);
  }

  kill(signal?: string): void {
    this.process.kill(signal);
  }

  onData(callback: (data: string) => void): () => void {
    const disposable = this.process.onData(callback);
    return () => {
      disposable.dispose();
    };
  }

  onExit(callback: (event: PtyAdapter.PtyExitEvent) => void): () => void {
    const disposable = this.process.onExit((event) => {
      callback({
        exitCode: event.exitCode,
        signal: event.signal ?? null,
      });
    });
    return () => {
      disposable.dispose();
    };
  }
}

export const make = Effect.fn("NodePtyAdapter.make")(function* (
  loadNodePtyModule: NodePtyModuleLoader = () => import("node-pty"),
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcessPlatform;
  const architecture = yield* HostProcessArchitecture;

  const nodePty = yield* Effect.tryPromise({
    try: loadNodePtyModule,
    catch: (cause) =>
      new NodePtyModuleLoadError({
        platform,
        architecture,
        cause,
      }),
  }).pipe(Effect.orDie);
  const consoleProcessListAgentPath =
    platform === "win32" ? resolveConsoleProcessListAgentPath() : null;

  const ensureNodePtySpawnHelperExecutableCached = yield* Effect.cached(
    ensureNodePtySpawnHelperExecutable().pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.provideService(HostProcessPlatform, platform),
      Effect.provideService(HostProcessArchitecture, architecture),
      Effect.orElseSucceed(() => undefined),
    ),
  );

  return PtyAdapter.PtyAdapter.of({
    spawn: Effect.fn("NodePtyAdapter.spawn")(function* (input) {
      yield* ensureNodePtySpawnHelperExecutableCached;
      const ptyProcess = yield* Effect.try({
        try: () =>
          nodePty.spawn(input.shell, input.args ?? [], {
            cwd: input.cwd,
            cols: input.cols,
            rows: input.rows,
            env: input.env,
            name: platform === "win32" ? "xterm-color" : "xterm-256color",
          }),
        catch: (cause) =>
          new PtyAdapter.PtySpawnError({
            adapter: "node-pty",
            shell: input.shell,
            cause,
          }),
      });
      return new NodePtyProcess(ptyProcess, consoleProcessListAgentPath, platform === "win32");
    }),
  });
});

export const layer = Layer.effect(PtyAdapter.PtyAdapter, make());
