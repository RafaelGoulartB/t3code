import { describe, expect, it } from "vite-plus/test";

import { jiraSearchToInput, parseJiraSearch } from "./jiraRoutes";

describe("Jira route search", () => {
  it("uses assigned open work items in board view by default", () => {
    expect(parseJiraSearch({})).toMatchObject({
      assignee: "mine",
      open: true,
      view: "board",
      limit: 50,
    });
  });

  it("uses custom JQL instead of ordinary filters", () => {
    expect(jiraSearchToInput(parseJiraSearch({ assignee: "all", jql: "project = APP" }))).toEqual({
      mode: "jql",
      jql: "project = APP",
      limit: 50,
    });
  });
});
