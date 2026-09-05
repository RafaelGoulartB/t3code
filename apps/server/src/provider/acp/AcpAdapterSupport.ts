import {
  type ProviderApprovalDecision,
  type ProviderDriverKind,
  type ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as EffectAcpErrors from "effect-acp/errors";

import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  type ProviderAdapterError,
} from "../Errors.ts";
const isAcpProcessExitedError = Schema.is(EffectAcpErrors.AcpProcessExitedError);
const isAcpRequestError = Schema.is(EffectAcpErrors.AcpRequestError);
const MAX_ACP_ERROR_DATA_LENGTH = 2_000;
const MAX_ACP_ERROR_DATA_DEPTH = 4;
const MAX_ACP_ERROR_DATA_ENTRIES = 50;
const MAX_ACP_ERROR_DATA_STRING_LENGTH = 500;
const MAX_ACP_ERROR_DATA_KEY_LENGTH = 100;
const SENSITIVE_ACP_ERROR_DATA_KEY =
  /token|password|secret|authorization|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|credential/i;

type DiagnosticProjection =
  | null
  | boolean
  | number
  | string
  | DiagnosticProjection[]
  | { [key: string]: DiagnosticProjection };

interface DiagnosticProjectionState {
  readonly seen: WeakSet<object>;
  remainingCharacters: number;
  remainingEntries: number;
}

function projectDiagnosticText(
  value: string,
  state: DiagnosticProjectionState,
  maximumLength = MAX_ACP_ERROR_DATA_STRING_LENGTH,
): string {
  const allowedLength = Math.min(maximumLength, state.remainingCharacters);
  if (allowedLength <= 0) return "…";

  const projected =
    value.length <= allowedLength ? value : `${value.slice(0, Math.max(0, allowedLength - 1))}…`;
  state.remainingCharacters -= projected.length;
  return projected;
}

function projectDiagnosticData(
  value: unknown,
  state: DiagnosticProjectionState,
  depth = 0,
): DiagnosticProjection {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") return projectDiagnosticText(value, state);
  if (typeof value !== "object") return `[${typeof value}]`;
  if (depth >= MAX_ACP_ERROR_DATA_DEPTH) return "[Maximum depth reached]";
  if (state.seen.has(value)) return "[Circular]";
  state.seen.add(value);

  if (Array.isArray(value)) {
    const projected: DiagnosticProjection[] = [];
    for (
      let index = 0;
      index < value.length && state.remainingEntries > 0 && state.remainingCharacters > 0;
      index += 1
    ) {
      state.remainingEntries -= 1;
      try {
        projected.push(projectDiagnosticData(value[index], state, depth + 1));
      } catch {
        projected.push("[Unavailable]");
      }
    }
    return projected;
  }

  const projected: { [key: string]: DiagnosticProjection } = Object.create(null);
  for (const key in value) {
    if (state.remainingEntries <= 0 || state.remainingCharacters <= 0) break;
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;

    state.remainingEntries -= 1;
    const projectedKey = projectDiagnosticText(key, state, MAX_ACP_ERROR_DATA_KEY_LENGTH);
    if (SENSITIVE_ACP_ERROR_DATA_KEY.test(key)) {
      projected[projectedKey] = "[REDACTED]";
      continue;
    }
    try {
      projected[projectedKey] = projectDiagnosticData(
        (value as Record<string, unknown>)[key],
        state,
        depth + 1,
      );
    } catch {
      projected[projectedKey] = "[Unavailable]";
    }
  }
  return projected;
}

function formatAcpRequestError(error: EffectAcpErrors.AcpRequestError): string {
  const summary = `${error.message} (ACP error ${error.code})`;
  if (error.data === undefined) return summary;

  try {
    const projected = projectDiagnosticData(error.data, {
      seen: new WeakSet(),
      remainingCharacters: MAX_ACP_ERROR_DATA_LENGTH,
      remainingEntries: MAX_ACP_ERROR_DATA_ENTRIES,
    });
    const encoded = JSON.stringify(projected);
    const details =
      encoded.length <= MAX_ACP_ERROR_DATA_LENGTH
        ? encoded
        : `${encoded.slice(0, MAX_ACP_ERROR_DATA_LENGTH - 1)}…`;
    return `${summary}. Details: ${details}`;
  } catch {
    return summary;
  }
}

export function mapAcpToAdapterError(
  provider: ProviderDriverKind,
  threadId: ThreadId,
  method: string,
  error: EffectAcpErrors.AcpError,
): ProviderAdapterError {
  if (isAcpProcessExitedError(error)) {
    return new ProviderAdapterSessionClosedError({
      provider,
      threadId,
      cause: error,
    });
  }
  if (isAcpRequestError(error)) {
    return new ProviderAdapterRequestError({
      provider,
      method,
      detail: formatAcpRequestError(error),
      cause: error,
    });
  }
  return new ProviderAdapterRequestError({
    provider,
    method,
    detail: error.message,
    cause: error,
  });
}

export function acpPermissionOutcome(decision: ProviderApprovalDecision): string {
  switch (decision) {
    case "acceptForSession":
      return "allow-always";
    case "accept":
      return "allow-once";
    case "decline":
    default:
      return "reject-once";
  }
}
