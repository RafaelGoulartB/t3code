import { createGitHubPullRequestEnvironmentAtoms } from "@t3tools/client-runtime/state/github-pull-requests";

import { connectionAtomRuntime } from "../connection/runtime";

export const githubPullRequestEnvironment =
  createGitHubPullRequestEnvironmentAtoms(connectionAtomRuntime);
