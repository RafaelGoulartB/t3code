import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { vcsCommandScheduler } from "./vcsCommandScheduler.ts";

export function createJiraEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    status: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:jira:status",
      tag: WS_METHODS.jiraStatus,
      staleTimeMs: 15_000,
    }),
    projects: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:jira:projects",
      tag: WS_METHODS.jiraProjectsList,
    }),
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:jira:work-items:list",
      tag: WS_METHODS.jiraWorkItemsList,
    }),
    details: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:jira:work-items:details",
      tag: WS_METHODS.jiraWorkItemsGet,
    }),
    comments: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:jira:work-items:comments",
      tag: WS_METHODS.jiraWorkItemsCommentsList,
    }),
    login: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:jira:login",
      tag: WS_METHODS.jiraAuthLogin,
      scheduler: vcsCommandScheduler,
    }),
    logout: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:jira:logout",
      tag: WS_METHODS.jiraAuthLogout,
      scheduler: vcsCommandScheduler,
    }),
    switchAccount: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:jira:switch",
      tag: WS_METHODS.jiraAuthSwitch,
      scheduler: vcsCommandScheduler,
    }),
    action: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:jira:action",
      tag: WS_METHODS.jiraWorkItemsAction,
      scheduler: vcsCommandScheduler,
    }),
    openInBrowser: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:jira:open",
      tag: WS_METHODS.jiraWorkItemsOpenInBrowser,
      scheduler: vcsCommandScheduler,
    }),
  };
}
