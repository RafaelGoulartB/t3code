import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ProjectId, ScopedProjectRef } from "@t3tools/contracts";
import { FolderIcon } from "lucide-react";
import { memo, useMemo } from "react";

import { resolveProjectLockedLabel } from "./BranchToolbar.logic";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

interface ProjectOption {
  value: ProjectId;
  label: string;
}

interface BranchToolbarProjectSelectorProps {
  projectLocked: boolean;
  activeProject: EnvironmentProject | null;
  availableProjects: ReadonlyArray<EnvironmentProject>;
  onProjectChange: (projectRef: ScopedProjectRef) => void;
}

export const BranchToolbarProjectSelector = memo(function BranchToolbarProjectSelector({
  projectLocked,
  activeProject,
  availableProjects,
  onProjectChange,
}: BranchToolbarProjectSelectorProps) {
  const projectItems = useMemo<ReadonlyArray<ProjectOption>>(
    () => availableProjects.map((project) => ({ value: project.id, label: project.title })),
    [availableProjects],
  );

  const activeProjectTitle = activeProject?.title ?? null;

  if (projectLocked || availableProjects.length === 0) {
    return (
      <span
        className="inline-flex items-center gap-1 border border-transparent px-[calc(--spacing(3)-1px)] text-sm font-medium text-muted-foreground/70 sm:text-xs"
        data-testid="branch-toolbar-project-locked"
        data-project-locked="true"
      >
        <FolderIcon className="size-3" />
        {resolveProjectLockedLabel(activeProject)}
      </span>
    );
  }

  return (
    <Select
      modal={false}
      value={activeProject?.id ?? null}
      onValueChange={(value) => {
        const next = availableProjects.find((project) => project.id === value);
        if (!next) return;
        onProjectChange({ environmentId: next.environmentId, projectId: next.id });
      }}
      items={projectItems}
    >
      <SelectTrigger
        variant="ghost"
        size="xs"
        className="font-medium"
        aria-label="Project"
        data-testid="branch-toolbar-project-trigger"
        data-project-locked="false"
      >
        <FolderIcon className="size-3" />
        <SelectValue placeholder={resolveProjectLockedLabel(activeProject)}>
          {activeProjectTitle}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup>
        <SelectGroup>
          <SelectGroupLabel>Project</SelectGroupLabel>
          {availableProjects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              <span className="inline-flex items-center gap-1.5">
                <FolderIcon className="size-3" />
                {project.title}
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectPopup>
    </Select>
  );
});
