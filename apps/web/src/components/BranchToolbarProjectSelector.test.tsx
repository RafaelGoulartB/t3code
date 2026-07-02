import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { scopeProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { BranchToolbarProjectSelector } from "./BranchToolbarProjectSelector";

const envA = EnvironmentId.make("environment-local");
const projectOneId = ProjectId.make("project-alpha");
const projectTwoId = ProjectId.make("project-beta");
const baseProject = {
  title: "alpha",
  workspaceRoot: "/repos/alpha",
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as const;

const activeProject: EnvironmentProject = scopeProject(envA, {
  id: projectOneId,
  ...baseProject,
});

const otherProject: EnvironmentProject = scopeProject(envA, {
  id: projectTwoId,
  title: "beta",
  workspaceRoot: "/repos/beta",
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("BranchToolbarProjectSelector", () => {
  it("renders a read-only span when the project is locked", () => {
    const onProjectChange = vi.fn();
    const markup = renderToStaticMarkup(
      <BranchToolbarProjectSelector
        projectLocked
        activeProject={activeProject}
        availableProjects={[activeProject, otherProject]}
        onProjectChange={onProjectChange}
      />,
    );

    expect(markup).toContain('data-testid="branch-toolbar-project-locked"');
    expect(markup).toContain('data-project-locked="true"');
    expect(markup).toContain("alpha");
    expect(markup).not.toContain('aria-label="Project"');
  });

  it("falls back to a generic label when the active project is missing", () => {
    const onProjectChange = vi.fn();
    const markup = renderToStaticMarkup(
      <BranchToolbarProjectSelector
        projectLocked
        activeProject={null}
        availableProjects={[]}
        onProjectChange={onProjectChange}
      />,
    );

    expect(markup).toContain('data-testid="branch-toolbar-project-locked"');
    expect(markup).toContain("Project");
  });

  it("renders the Select trigger when the project is editable", () => {
    const onProjectChange = vi.fn();
    const markup = renderToStaticMarkup(
      <BranchToolbarProjectSelector
        projectLocked={false}
        activeProject={activeProject}
        availableProjects={[activeProject, otherProject]}
        onProjectChange={onProjectChange}
      />,
    );

    expect(markup).toContain('data-testid="branch-toolbar-project-trigger"');
    expect(markup).toContain('data-project-locked="false"');
    expect(markup).toContain('aria-label="Project"');
    expect(markup).toContain("alpha");
  });

  it("renders the Select trigger with a placeholder when the project is missing", () => {
    const onProjectChange = vi.fn();
    const markup = renderToStaticMarkup(
      <BranchToolbarProjectSelector
        projectLocked={false}
        activeProject={null}
        availableProjects={[activeProject, otherProject]}
        onProjectChange={onProjectChange}
      />,
    );

    expect(markup).toContain('data-testid="branch-toolbar-project-trigger"');
    expect(markup).toContain('aria-label="Project"');
    expect(markup).toContain("Project");
  });
});
