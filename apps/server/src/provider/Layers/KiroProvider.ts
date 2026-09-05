import {
  type KiroSettings,
  type ModelCapabilities,
  type ServerProvider,
  type ServerProviderAuth,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { causeErrorTag } from "@t3tools/shared/observability";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { expandHomePath } from "../../pathExpansion.ts";
import {
  AUTH_PROBE_TIMEOUT_MS,
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  type ProviderMaintenanceCapabilities,
} from "../providerMaintenance.ts";

const KIRO_PRESENTATION = {
  displayName: "Kiro",
  badgeLabel: "Early Access",
  showInteractionModeToggle: true,
} as const;
const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});
const VERSION_PROBE_TIMEOUT_MS = 4_000;
const MODEL_PROBE_TIMEOUT_MS = 8_000;
const KIRO_API_KEY_ENV = "KIRO_API_KEY";

const KiroCliModel = Schema.Struct({
  model_name: Schema.String,
  model_id: Schema.String,
  description: Schema.optional(Schema.String),
});
const KiroCliModelsPayload = Schema.Struct({
  models: Schema.Array(KiroCliModel),
  default_model: Schema.optional(Schema.String),
});
const decodeKiroCliModelsPayload = Schema.decodeUnknownOption(
  Schema.fromJsonString(KiroCliModelsPayload),
);

const KIRO_FALLBACK_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "auto",
    name: "Auto",
    isCustom: false,
    isDefault: true,
    capabilities: EMPTY_CAPABILITIES,
  },
];

function kiroModelsFromSettings(
  customModels: ReadonlyArray<string> | undefined,
  builtInModels: ReadonlyArray<ServerProviderModel> = KIRO_FALLBACK_MODELS,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(builtInModels, customModels ?? [], EMPTY_CAPABILITIES);
}

export function parseKiroModelsJson(output: string): ReadonlyArray<ServerProviderModel> {
  const decoded = decodeKiroCliModelsPayload(output.trim());
  if (Option.isNone(decoded)) return [];

  const defaultModel = decoded.value.default_model?.trim();
  const seen = new Set<string>();
  return decoded.value.models.flatMap((model): ServerProviderModel[] => {
    const slug = model.model_id.trim();
    if (!slug || seen.has(slug)) return [];
    seen.add(slug);
    const name = model.model_name.trim() || slug;
    return [
      {
        slug,
        name,
        isCustom: false,
        ...(slug === defaultModel ? { isDefault: true } : {}),
        capabilities: EMPTY_CAPABILITIES,
      },
    ];
  });
}

function makeKiroEnvironment(
  settings: Pick<KiroSettings, "homePath">,
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const homePath = settings.homePath.trim();
  return {
    ...environment,
    ...(homePath ? { KIRO_HOME: expandHomePath(homePath) } : {}),
  };
}

const runKiroCliCommand = (
  settings: KiroSettings,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv,
) =>
  Effect.gen(function* () {
    const command = settings.binaryPath || "kiro-cli";
    const resolvedEnvironment = makeKiroEnvironment(settings, environment);
    const spawnCommand = yield* resolveSpawnCommand(command, args, {
      env: resolvedEnvironment,
    });
    return yield* spawnAndCollect(
      command,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: resolvedEnvironment,
        shell: spawnCommand.shell,
      }),
    );
  });

export function buildInitialKiroProviderSnapshot(
  settings: KiroSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = kiroModelsFromSettings(settings.customModels);
    if (!settings.enabled) {
      return buildServerProvider({
        presentation: KIRO_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Kiro is disabled in T3 Code settings.",
        },
      });
    }
    return buildServerProvider({
      presentation: KIRO_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Checking Kiro CLI availability...",
      },
    });
  });
}

export const checkKiroProviderStatus = Effect.fn("checkKiroProviderStatus")(function* (
  settings: KiroSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const fallbackModels = kiroModelsFromSettings(settings.customModels);

  if (!settings.enabled) {
    return yield* buildInitialKiroProviderSnapshot(settings);
  }

  const versionResult = yield* runKiroCliCommand(settings, ["--version"], environment).pipe(
    Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS),
    Effect.result,
  );
  if (Result.isFailure(versionResult)) {
    const error = versionResult.failure;
    return buildServerProvider({
      presentation: KIRO_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "Kiro CLI (`kiro-cli`) is not installed or not on PATH."
          : "Failed to execute the Kiro CLI health check.",
      },
    });
  }
  if (Option.isNone(versionResult.success)) {
    return buildServerProvider({
      presentation: KIRO_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Kiro CLI timed out while running `kiro-cli --version`.",
      },
    });
  }

  const versionOutput = versionResult.success.value;
  const version = parseGenericCliVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`);
  if (versionOutput.code !== 0) {
    return buildServerProvider({
      presentation: KIRO_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: "Kiro CLI is installed but failed to run.",
      },
    });
  }

  const authResult = yield* runKiroCliCommand(
    settings,
    ["whoami", "--format", "json"],
    environment,
  ).pipe(Effect.timeoutOption(AUTH_PROBE_TIMEOUT_MS), Effect.result);
  const apiKeyConfigured = Boolean(environment[KIRO_API_KEY_ENV]?.trim());
  const auth: ServerProviderAuth = apiKeyConfigured
    ? { status: "authenticated", type: "api_key", label: "Kiro API key" }
    : Result.isSuccess(authResult) &&
        Option.isSome(authResult.success) &&
        authResult.success.value.code === 0
      ? { status: "authenticated", type: "cached_token", label: "Kiro account" }
      : Result.isSuccess(authResult) && Option.isSome(authResult.success)
        ? { status: "unauthenticated" }
        : { status: "unknown" };

  const modelsResult = yield* runKiroCliCommand(
    settings,
    ["chat", "--list-models", "--format", "json"],
    environment,
  ).pipe(Effect.timeoutOption(MODEL_PROBE_TIMEOUT_MS), Effect.result);
  const modelOutput =
    Result.isSuccess(modelsResult) &&
    Option.isSome(modelsResult.success) &&
    modelsResult.success.value.code === 0
      ? modelsResult.success.value.stdout
      : undefined;
  const discoveredModels = modelOutput ? parseKiroModelsJson(modelOutput) : [];
  const models = kiroModelsFromSettings(
    settings.customModels,
    discoveredModels.length > 0 ? discoveredModels : KIRO_FALLBACK_MODELS,
  );

  if (auth.status === "unauthenticated") {
    return buildServerProvider({
      presentation: KIRO_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version,
        status: "error",
        auth,
        message: "Kiro CLI is installed but not logged in. Run `kiro-cli login`.",
      },
    });
  }

  const modelProbeFailed = discoveredModels.length === 0;
  return buildServerProvider({
    presentation: KIRO_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: true,
      version,
      status: modelProbeFailed ? "warning" : "ready",
      auth,
      ...(modelProbeFailed
        ? { message: "Kiro CLI is available, but its model catalog could not be loaded." }
        : {}),
    },
  });
});

export const enrichKiroSnapshot = (input: {
  readonly snapshot: ServerProvider;
  readonly maintenanceCapabilities: ProviderMaintenanceCapabilities;
  readonly enableProviderUpdateChecks?: boolean;
  readonly publishSnapshot: (snapshot: ServerProvider) => Effect.Effect<void>;
  readonly httpClient: HttpClient.HttpClient;
}): Effect.Effect<void> =>
  enrichProviderSnapshotWithVersionAdvisory(input.snapshot, input.maintenanceCapabilities, {
    enableProviderUpdateChecks: input.enableProviderUpdateChecks,
  }).pipe(
    Effect.provideService(HttpClient.HttpClient, input.httpClient),
    Effect.flatMap(input.publishSnapshot),
    Effect.catchCause((cause) =>
      Effect.logWarning("Kiro version advisory enrichment failed", {
        errorTag: causeErrorTag(cause),
      }),
    ),
    Effect.asVoid,
  );
