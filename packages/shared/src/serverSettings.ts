import { ServerSettings, type ServerSettingsPatch } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { deepMerge } from "./Struct.ts";
import { fromLenientJson } from "./schemaJson.ts";
import { createModelSelection } from "./model.ts";

const ServerSettingsJson = fromLenientJson(ServerSettings);
const decodeServerSettingsJson = Schema.decodeUnknownOption(ServerSettingsJson);

export interface PersistedServerObservabilitySettings {
  readonly otlpTracesUrl: string | undefined;
  readonly otlpMetricsUrl: string | undefined;
}

export function normalizePersistedServerSettingString(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function extractPersistedServerObservabilitySettings(input: {
  readonly observability?: {
    readonly otlpTracesUrl?: string;
    readonly otlpMetricsUrl?: string;
  };
}): PersistedServerObservabilitySettings {
  return {
    otlpTracesUrl: normalizePersistedServerSettingString(input.observability?.otlpTracesUrl),
    otlpMetricsUrl: normalizePersistedServerSettingString(input.observability?.otlpMetricsUrl),
  };
}

export function parsePersistedServerObservabilitySettings(
  raw: string,
): PersistedServerObservabilitySettings {
  const decoded = decodeServerSettingsJson(raw);
  if (Option.isSome(decoded)) {
    return extractPersistedServerObservabilitySettings(decoded.value);
  }
  return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined };
}

function shouldReplaceTextGenerationModelSelection(
  patch: ServerSettingsPatch["textGenerationModelSelection"] | undefined,
): boolean {
  return Boolean(patch && (patch.instanceId !== undefined || patch.model !== undefined));
}

function mergeModelSelectionOptionsById(input: {
  current: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }> | undefined;
  patch: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }> | undefined;
}): Array<{ id: string; value: string | boolean }> | undefined {
  if (input.patch === undefined) {
    return input.current ? [...input.current] : undefined;
  }
  if (input.patch.length === 0) {
    return undefined;
  }

  const merged = new Map((input.current ?? []).map((selection) => [selection.id, selection.value]));
  for (const selection of input.patch) {
    merged.set(selection.id, selection.value);
  }
  return [...merged.entries()].map(([id, value]) => ({ id, value }));
}

/**
 * Applies a server settings patch while treating textGenerationModelSelection as
 * replace-on-provider/model updates. This prevents stale nested options from
 * surviving a reset patch that intentionally omits options.
 */
export function applyServerSettingsPatch(
  current: ServerSettings,
  patch: ServerSettingsPatch,
): ServerSettings {
  const selectionPatch = patch.textGenerationModelSelection;
  const policyPatch = patch.textGenerationPolicy;
  const {
    automaticGitFetchInterval,
    textGenerationPolicy: _policyPatchOmitted,
    ...patchForMerge
  } = patch;
  const next = deepMerge(current, patchForMerge);
  const nextWithReplacements = {
    ...next,
    ...(patch.providerInstances !== undefined
      ? { providerInstances: patch.providerInstances }
      : {}),
    ...(automaticGitFetchInterval !== undefined ? { automaticGitFetchInterval } : {}),
  };
  let result: ServerSettings = nextWithReplacements;

  if (selectionPatch) {
    const instanceId = selectionPatch.instanceId ?? current.textGenerationModelSelection.instanceId;
    const model = selectionPatch.model ?? current.textGenerationModelSelection.model;
    const options = shouldReplaceTextGenerationModelSelection(selectionPatch)
      ? selectionPatch.options
      : mergeModelSelectionOptionsById({
          current: current.textGenerationModelSelection.options,
          patch: selectionPatch.options,
        });

    result = {
      ...result,
      textGenerationModelSelection: createModelSelection(instanceId, model, options),
    };
  }

  if (policyPatch) {
    const currentPolicy = current.textGenerationPolicy;
    const mergeInstructions = (
      explicit: string | undefined,
      inherited: string | undefined,
    ): string | undefined => (explicit !== undefined ? explicit : inherited);
    const nextKind = policyPatch.kind ?? currentPolicy.kind;
    const kindChanged = nextKind !== currentPolicy.kind;
    const pickInstructions = (
      explicit: string | undefined,
      inherited: string | undefined,
    ): string | undefined => {
      if (policyPatch.kind !== undefined && kindChanged && explicit === undefined) {
        return undefined;
      }
      return mergeInstructions(explicit, inherited);
    };

    result = {
      ...result,
      textGenerationPolicy: {
        kind: nextKind,
        commitInstructions: pickInstructions(
          policyPatch.commitInstructions,
          currentPolicy.commitInstructions,
        ),
        changeRequestInstructions: pickInstructions(
          policyPatch.changeRequestInstructions,
          currentPolicy.changeRequestInstructions,
        ),
        branchInstructions: pickInstructions(
          policyPatch.branchInstructions,
          currentPolicy.branchInstructions,
        ),
        threadTitleInstructions: pickInstructions(
          policyPatch.threadTitleInstructions,
          currentPolicy.threadTitleInstructions,
        ),
        inferRepositoryConventions:
          policyPatch.inferRepositoryConventions ?? currentPolicy.inferRepositoryConventions,
      },
    };
  }

  return result;
}
