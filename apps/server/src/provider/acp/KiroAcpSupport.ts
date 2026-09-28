import { type KiroSettings, type ProviderOptionSelection } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";

import { expandHomePath } from "../../pathExpansion.ts";
import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

type KiroAcpRuntimeSettings = Pick<
  KiroSettings,
  "agent" | "agentEngine" | "binaryPath" | "homePath"
>;

export interface KiroAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly kiroSettings: KiroAcpRuntimeSettings;
  readonly environment?: NodeJS.ProcessEnv;
}

export interface KiroAcpModelSelectionErrorContext {
  readonly cause: EffectAcpErrors.AcpError;
  readonly step: "set-config-option" | "set-model";
  readonly configId?: string;
}

export function buildKiroAcpSpawnInput(
  settings: KiroAcpRuntimeSettings,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AcpSessionRuntime.AcpSpawnInput {
  const homePath = settings.homePath.trim();
  return {
    command: settings.binaryPath || "kiro-cli",
    args: [
      "acp",
      ...(settings.agent.trim() ? ["--agent", settings.agent.trim()] : []),
      ...(settings.agentEngine.trim() ? ["--agent-engine", settings.agentEngine.trim()] : []),
    ],
    cwd,
    env: {
      ...environment,
      ...(homePath ? { KIRO_HOME: expandHomePath(homePath) } : {}),
    },
  };
}

export const makeKiroAcpRuntime = (
  input: KiroAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildKiroAcpSpawnInput(input.kiroSettings, input.cwd, input.environment),
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
  });

interface KiroAcpModelSelectionRuntime {
  readonly getConfigOptions: AcpSessionRuntime.AcpSessionRuntime["Service"]["getConfigOptions"];
  readonly setConfigOption: (
    configId: string,
    value: string | boolean,
  ) => Effect.Effect<unknown, EffectAcpErrors.AcpError>;
  readonly setSessionModel: (modelId: string) => Effect.Effect<unknown, EffectAcpErrors.AcpError>;
}

function normalizeConfigId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function applyKiroAcpModelSelection<E>(input: {
  readonly runtime: KiroAcpModelSelectionRuntime;
  readonly model: string | null | undefined;
  readonly selections: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  readonly mapError: (context: KiroAcpModelSelectionErrorContext) => E;
}): Effect.Effect<void, E> {
  return Effect.gen(function* () {
    const model = input.model?.trim();
    if (model) {
      yield* input.runtime
        .setSessionModel(model)
        .pipe(Effect.mapError((cause) => input.mapError({ cause, step: "set-model" })));
    }

    const configOptions = yield* input.runtime.getConfigOptions;
    for (const selection of input.selections ?? []) {
      const normalizedSelectionId = normalizeConfigId(selection.id);
      const configOption = configOptions.find(
        (option) => normalizeConfigId(option.id) === normalizedSelectionId,
      );
      if (!configOption) continue;
      yield* input.runtime.setConfigOption(configOption.id, selection.value).pipe(
        Effect.mapError((cause) =>
          input.mapError({
            cause,
            step: "set-config-option",
            configId: configOption.id,
          }),
        ),
      );
    }
  });
}
