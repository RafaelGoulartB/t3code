import { type EnvironmentId, type JiraWorkItemAction } from "@t3tools/contracts";
import { useCallback, useState } from "react";

import { toastManager } from "../components/ui/toast";
import { jiraEnvironment } from "../state/jira";
import { useAtomCommand } from "../state/use-atom-command";

type Refresh = () => void;

/**
 * One mutation policy for Jira surfaces. Server data remains authoritative: a
 * successful write refreshes every mounted surface supplied by its caller and
 * a failed write deliberately leaves the previous UI intact.
 */
export function useJiraWorkItemMutation(
  environmentId: EnvironmentId | null,
  refresh: ReadonlyArray<Refresh> = [],
) {
  const action = useAtomCommand(jiraEnvironment.action, { reportFailure: false });
  const [pendingKind, setPendingKind] = useState<JiraWorkItemAction["kind"] | null>(null);

  const run = useCallback(
    async (input: JiraWorkItemAction): Promise<boolean> => {
      if (!environmentId) return false;
      setPendingKind(input.kind);
      const result = await action({ environmentId, input });
      setPendingKind(null);
      if (result._tag !== "Success") {
        toastManager.add({
          type: "error",
          title: "Jira action could not be completed",
          description: "Your existing work item data was left unchanged. Please retry.",
        });
        return false;
      }
      refresh.forEach((refreshData) => refreshData());
      toastManager.add({
        type: "success",
        title: "Jira updated",
        description: "The latest data is being refreshed.",
      });
      return true;
    },
    [action, environmentId, refresh],
  );

  return { run, pendingKind };
}
