// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { KiroSettings, ProviderDriverKind, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import { makeKiroAdapter } from "./KiroAdapter.ts";

const decodeKiroSettings = Schema.decodeSync(KiroSettings);
const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../../../scripts/acp-mock-agent.ts");

async function makeMockAgentWrapper(requestLogPath: string) {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "kiro-acp-mock-"));
  const wrapperPath = NodePath.join(dir, "fake-kiro-cli.sh");
  const script = `#!/bin/sh
export T3_ACP_REQUEST_LOG_PATH=${JSON.stringify(requestLogPath)}
exec node ${JSON.stringify(mockAgentPath)} "$@"
`;
  await NodeFSP.writeFile(wrapperPath, script, "utf8");
  await NodeFSP.chmod(wrapperPath, 0o755);
  return wrapperPath;
}

it.effect("runs a Kiro ACP session without sending authenticate", () =>
  Effect.gen(function* () {
    const requestLogPath = NodePath.join(
      yield* Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "kiro-log-"))),
      "requests.jsonl",
    );
    const wrapperPath = yield* Effect.promise(() => makeMockAgentWrapper(requestLogPath));
    const adapter = yield* makeKiroAdapter(
      decodeKiroSettings({ enabled: true, binaryPath: wrapperPath }),
    );
    const threadId = ThreadId.make("kiro-mock-thread");
    const eventsFiber = yield* Stream.take(adapter.streamEvents, 9).pipe(
      Stream.runCollect,
      Effect.forkChild,
    );

    const session = yield* adapter.startSession({
      threadId,
      provider: ProviderDriverKind.make("kiro"),
      cwd: process.cwd(),
      runtimeMode: "full-access",
      modelSelection: {
        instanceId: ProviderInstanceId.make("kiro"),
        model: "grok-4.6",
      },
    });
    assert.equal(session.provider, "kiro");
    assert.deepStrictEqual(session.resumeCursor, {
      schemaVersion: 1,
      sessionId: "mock-session-1",
    });

    yield* adapter.sendTurn({
      threadId,
      input: "hello from Kiro",
      attachments: [],
    });

    const events = Array.from(yield* Fiber.join(eventsFiber));
    assert.include(
      events.map((event) => event.type),
      "content.delta",
    );
    assert.isTrue(events.every((event) => event.provider === "kiro"));

    const requestLog = yield* Effect.promise(() => NodeFSP.readFile(requestLogPath, "utf8"));
    assert.notInclude(requestLog, '"method":"authenticate"');
    assert.include(requestLog, '"method":"session/new"');
    assert.include(requestLog, '"method":"session/set_model"');

    yield* adapter.stopSession(threadId);
  }).pipe(
    Effect.scoped,
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), {
        prefix: "t3code-kiro-adapter-test-",
      }).pipe(Layer.provideMerge(NodeServices.layer)),
    ),
  ),
);
