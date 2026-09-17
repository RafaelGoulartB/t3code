import {
  type CursorSettings,
  type KiroSettings,
  ProviderDriverKind,
  type ProviderInstanceId,
} from "@t3tools/contracts";

import { applyKiroAcpModelSelection, makeKiroAcpRuntime } from "../acp/KiroAcpSupport.ts";
import { makeCursorAdapter, type CursorAdapterLiveOptions } from "./CursorAdapter.ts";

const KIRO_PROVIDER = ProviderDriverKind.make("kiro");

export interface KiroAdapterLiveOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: CursorAdapterLiveOptions["nativeEventLogger"];
  readonly instanceId?: ProviderInstanceId;
}

export function makeKiroAdapter(kiroSettings: KiroSettings, options?: KiroAdapterLiveOptions) {
  const compatibilitySettings: CursorSettings = {
    enabled: kiroSettings.enabled,
    binaryPath: kiroSettings.binaryPath,
    apiEndpoint: "",
    customModels: kiroSettings.customModels,
  };

  return makeCursorAdapter(compatibilitySettings, {
    provider: KIRO_PROVIDER,
    providerDisplayName: "Kiro",
    enableCursorExtensions: false,
    resolveAcpBaseModelId: (model) => model?.trim() || "auto",
    applyAcpModelSelection: applyKiroAcpModelSelection,
    makeAcpRuntime: ({ cursorSettings: _cursorSettings, ...input }) =>
      makeKiroAcpRuntime({
        ...input,
        kiroSettings,
      }),
    ...(options?.environment ? { environment: options.environment } : {}),
    ...(options?.nativeEventLogPath ? { nativeEventLogPath: options.nativeEventLogPath } : {}),
    ...(options?.nativeEventLogger ? { nativeEventLogger: options.nativeEventLogger } : {}),
    ...(options?.instanceId ? { instanceId: options.instanceId } : {}),
  });
}
