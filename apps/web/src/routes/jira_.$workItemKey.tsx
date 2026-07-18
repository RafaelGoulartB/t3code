import { createFileRoute } from "@tanstack/react-router";

import { JiraWorkItemDetailsPage } from "../components/JiraPage";
import { parseJiraSearch } from "../jiraRoutes";

export const Route = createFileRoute("/jira_/$workItemKey")({
  validateSearch: parseJiraSearch,
  component: JiraWorkItemDetailsPage,
});
