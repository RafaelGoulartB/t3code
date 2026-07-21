import { createFileRoute, redirect } from "@tanstack/react-router";

import { GitHubPullRequestDetailsPage } from "../components/GitHubPullRequestsPage";
import { parsePullRequestSearch } from "../pullRequestRoutes";

export const Route = createFileRoute("/pull-requests_/$owner/$repo/$number")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  validateSearch: parsePullRequestSearch,
  component: GitHubPullRequestDetailsPage,
});
