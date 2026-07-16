import { createFileRoute, redirect } from "@tanstack/react-router";

import { KanbanPage } from "../components/KanbanPage";

export const Route = createFileRoute("/kanban")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: KanbanPage,
});
