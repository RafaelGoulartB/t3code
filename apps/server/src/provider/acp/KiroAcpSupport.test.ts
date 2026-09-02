import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { KiroSettings } from "@t3tools/contracts";
import { applyKiroAcpModelSelection, buildKiroAcpSpawnInput } from "./KiroAcpSupport.ts";

const decodeKiroSettings = Schema.decodeSync(KiroSettings);

describe("KiroAcpSupport", () => {
  it("builds the Kiro ACP command and isolated home environment", () => {
    const input = buildKiroAcpSpawnInput(
      decodeKiroSettings({
        binaryPath: "/opt/kiro-cli",
        homePath: "/tmp/kiro-home",
        agent: "reviewer",
        agentEngine: "v3",
      }),
      "/workspace",
      { EXISTING: "value" },
    );

    assert.equal(input.command, "/opt/kiro-cli");
    assert.deepStrictEqual(input.args, ["acp", "--agent", "reviewer", "--agent-engine", "v3"]);
    assert.equal(input.cwd, "/workspace");
    assert.equal(input.env?.EXISTING, "value");
    assert.equal(input.env?.KIRO_HOME, "/tmp/kiro-home");
  });

  it.effect("applies the selected model and advertised config options", () =>
    Effect.gen(function* () {
      const calls: Array<readonly [string, string | boolean]> = [];
      yield* applyKiroAcpModelSelection({
        runtime: {
          getConfigOptions: Effect.succeed([
            {
              id: "effort",
              name: "Effort",
              type: "select" as const,
              currentValue: "medium",
              options: [
                { value: "medium", name: "Medium" },
                { value: "high", name: "High" },
              ],
            },
          ]),
          setSessionModel: (modelId) =>
            Effect.sync(() => {
              calls.push(["model", modelId]);
              return {};
            }),
          setConfigOption: (configId, value) =>
            Effect.sync(() => {
              calls.push([configId, value]);
              return {};
            }),
        },
        model: "claude-sonnet-5",
        selections: [{ id: "effort", value: "high" }],
        mapError: (error) => error,
      });

      assert.deepStrictEqual(calls, [
        ["model", "claude-sonnet-5"],
        ["effort", "high"],
      ]);
    }),
  );
});
