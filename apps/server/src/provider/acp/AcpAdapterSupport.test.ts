import { describe, expect, it } from "vite-plus/test";
import * as EffectAcpErrors from "effect-acp/errors";
import { ProviderDriverKind } from "@t3tools/contracts";

import { acpPermissionOutcome, mapAcpToAdapterError } from "./AcpAdapterSupport.ts";

describe("AcpAdapterSupport", () => {
  it("maps ACP approval decisions to permission outcomes", () => {
    expect(acpPermissionOutcome("accept")).toBe("allow-once");
    expect(acpPermissionOutcome("acceptForSession")).toBe("allow-always");
    expect(acpPermissionOutcome("decline")).toBe("reject-once");
  });

  it("maps ACP request errors with their protocol code and useful diagnostic data", () => {
    const error = mapAcpToAdapterError(
      ProviderDriverKind.make("kiro"),
      "thread-1" as never,
      "session/prompt",
      new EffectAcpErrors.AcpRequestError({
        code: -32603,
        errorMessage: "Internal error",
        data: { reason: "context limit exceeded" },
      }),
    );

    expect(error._tag).toBe("ProviderAdapterRequestError");
    expect(error.message).toContain("Internal error (ACP error -32603)");
    expect(error.message).toContain('Details: {"reason":"context limit exceeded"}');
  });

  it("redacts secrets from ACP diagnostic data", () => {
    const error = mapAcpToAdapterError(
      ProviderDriverKind.make("kiro"),
      "thread-1" as never,
      "session/prompt",
      new EffectAcpErrors.AcpRequestError({
        code: -32603,
        errorMessage: "Internal error",
        data: {
          reason: "authentication failed",
          context: {
            authorization: "Bearer private-token",
            apiKey: "private-api-key",
          },
        },
      }),
    );

    expect(error.message).toContain('"reason":"authentication failed"');
    expect(error.message).toContain('"authorization":"[REDACTED]"');
    expect(error.message).toContain('"apiKey":"[REDACTED]"');
    expect(error.message).not.toContain("private-token");
    expect(error.message).not.toContain("private-api-key");
  });

  it("bounds traversal and output for large ACP diagnostic data", () => {
    const data = Array.from({ length: 10_000 }, (_, index) => ({
      reason: `entry-${index}-${"x".repeat(1_000)}`,
    }));
    const error = mapAcpToAdapterError(
      ProviderDriverKind.make("kiro"),
      "thread-1" as never,
      "session/prompt",
      new EffectAcpErrors.AcpRequestError({
        code: -32603,
        errorMessage: "Internal error",
        data,
      }),
    );

    const details = error.message.split(". Details: ")[1];
    expect(details).toBeDefined();
    expect(details!.length).toBeLessThanOrEqual(2_000);
    expect(details).toContain("entry-0-");
    expect(details).not.toContain("entry-9999-");
  });
});
