import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { JiraSettings, JiraWorkItemAction } from "./jira.ts";

const decodeJiraSettings = Schema.decodeSync(JiraSettings);
const decodeJiraWorkItemAction = Schema.decodeUnknownSync(JiraWorkItemAction);

describe("Jira contracts", () => {
  it("defaults the integration to disabled with the ACLI binary", () => {
    expect(decodeJiraSettings({})).toEqual({ enabled: false, binaryPath: "acli" });
  });

  it("rejects a write action without its required fields", () => {
    expect(() => decodeJiraWorkItemAction({ kind: "transition", key: "PROJ-1" })).toThrow();
  });
});
