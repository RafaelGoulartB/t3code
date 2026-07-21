import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { vcsCommandScheduler } from "./vcsCommandScheduler.ts";

export function createGitHubPullRequestEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:github:pull-requests:list",
      tag: WS_METHODS.githubPullRequestsList,
    }),
    details: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:github:pull-requests:details",
      tag: WS_METHODS.githubPullRequestsGet,
    }),
    checks: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:github:pull-requests:checks",
      tag: WS_METHODS.githubPullRequestsChecks,
    }),
    diff: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:github:pull-requests:diff",
      tag: WS_METHODS.githubPullRequestsDiff,
    }),
    action: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:github:pull-requests:action",
      tag: WS_METHODS.githubPullRequestsAction,
      scheduler: vcsCommandScheduler,
    }),
    checkout: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:github:pull-requests:checkout",
      tag: WS_METHODS.githubPullRequestsCheckout,
      scheduler: vcsCommandScheduler,
    }),
  };
}
