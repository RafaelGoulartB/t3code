import type { DiscoveredLocalServer, EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useMemo } from "react";

import { previewEnvironment } from "./state/preview";
import { useEnvironmentQuery } from "./state/query";

const EMPTY_PORTS: ReadonlyArray<DiscoveredLocalServer> = Object.freeze([]);

export function useDiscoveredPorts(
  environmentId: EnvironmentId | null,
): ReadonlyArray<DiscoveredLocalServer> {
  const query = useEnvironmentQuery(
    environmentId === null
      ? null
      : previewEnvironment.discoveredServers({ environmentId, input: {} }),
  );
  return query.data?.servers ?? EMPTY_PORTS;
}

export function useProjectDiscoveredPorts(input: {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | null;
  readonly worktreePath: string | null;
}): ReadonlyArray<DiscoveredLocalServer> {
  const ports = useDiscoveredPorts(input.environmentId);
  return useMemo(
    () =>
      input.projectId
        ? ports.filter(
            (port) =>
              port.terminal?.projectId === input.projectId &&
              port.terminal.worktreePath === input.worktreePath,
          )
        : EMPTY_PORTS,
    [input.projectId, input.worktreePath, ports],
  );
}

export const useThreadDiscoveredPorts = useProjectDiscoveredPorts;

export function useTerminalDiscoveredPorts(input: {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | null;
  readonly worktreePath: string | null;
  readonly terminalId: string | null;
}): ReadonlyArray<DiscoveredLocalServer> {
  const ports = useDiscoveredPorts(input.environmentId);
  return useMemo(
    () =>
      input.projectId && input.terminalId
        ? ports.filter(
            (port) =>
              port.terminal?.projectId === input.projectId &&
              port.terminal.worktreePath === input.worktreePath &&
              port.terminal.terminalId === input.terminalId,
          )
        : EMPTY_PORTS,
    [input.projectId, input.terminalId, input.worktreePath, ports],
  );
}
