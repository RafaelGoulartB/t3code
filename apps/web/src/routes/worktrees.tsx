import { createFileRoute, redirect } from "@tanstack/react-router";

import { WorktreesPage } from "../components/WorktreesPage";

export const Route = createFileRoute("/worktrees")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: WorktreesPage,
});
