import {
  DEFAULT_SIDEBAR_PROJECT_FOLDER_COLOR,
  SIDEBAR_PROJECT_FOLDER_COLOR_PRESETS,
  type SidebarProjectFolderColor,
} from "@t3tools/contracts/settings";
import type { SidebarProjectSnapshot } from "./sidebarProjectGrouping";

export const UNFILED_PROJECT_FOLDER_ID = "__unfiled__";

export interface SidebarProjectFolder {
  readonly id: string;
  readonly name: string;
  readonly color: SidebarProjectFolderColor;
}

export interface SidebarProjectFolderBucket {
  readonly id: string;
  readonly name: string;
  readonly color: SidebarProjectFolderColor | null;
  readonly kind: "folder" | "unfiled";
  readonly projects: SidebarProjectSnapshot[];
}

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const PRESET_COLORS = new Set<string>(SIDEBAR_PROJECT_FOLDER_COLOR_PRESETS);

export function isSidebarProjectFolderColor(value: string): value is SidebarProjectFolderColor {
  return PRESET_COLORS.has(value) || HEX_COLOR_PATTERN.test(value);
}

function representativePhysicalProjectKey(project: SidebarProjectSnapshot): string | null {
  return (
    project.memberProjects.find(
      (member) => member.environmentId === project.environmentId && member.id === project.id,
    )?.physicalProjectKey ??
    project.memberProjects[0]?.physicalProjectKey ??
    null
  );
}

export function resolveSidebarProjectFolderId(
  project: SidebarProjectSnapshot,
  assignments: Readonly<Record<string, string>>,
  validFolderIds?: ReadonlySet<string>,
): string | null {
  const memberFolderIds = project.memberProjects.flatMap((member) => {
    const folderId = assignments[member.physicalProjectKey];
    if (!folderId) return [];
    if (validFolderIds && !validFolderIds.has(folderId)) return [];
    return [folderId];
  });
  const uniqueFolderIds = [...new Set(memberFolderIds)];
  if (uniqueFolderIds.length === 0) {
    return null;
  }
  if (uniqueFolderIds.length === 1) {
    return uniqueFolderIds[0] ?? null;
  }

  const representativeKey = representativePhysicalProjectKey(project);
  const representativeFolderId = representativeKey ? assignments[representativeKey] : undefined;
  if (representativeFolderId && (!validFolderIds || validFolderIds.has(representativeFolderId))) {
    return representativeFolderId;
  }

  return uniqueFolderIds[0] ?? null;
}

function orderFolders(
  folders: readonly SidebarProjectFolder[],
  folderOrder: readonly string[],
): SidebarProjectFolder[] {
  const folderById = new Map(folders.map((folder) => [folder.id, folder] as const));
  const emitted = new Set<string>();
  const ordered = folderOrder.flatMap((folderId) => {
    const folder = folderById.get(folderId);
    if (!folder || emitted.has(folder.id)) return [];
    emitted.add(folder.id);
    return [folder];
  });
  const remaining = folders
    .filter((folder) => !emitted.has(folder.id))
    .toSorted(
      (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
  return [...ordered, ...remaining];
}

export function buildSidebarProjectFolderBuckets(input: {
  readonly projects: readonly SidebarProjectSnapshot[];
  readonly folders: readonly SidebarProjectFolder[];
  readonly folderOrder: readonly string[];
  readonly assignments: Readonly<Record<string, string>>;
}): SidebarProjectFolderBucket[] {
  if (input.projects.length === 0) {
    return [];
  }

  const sanitized = sanitizeSidebarProjectFolders({
    folders: input.folders,
    folderOrder: input.folderOrder,
    assignments: input.assignments,
  });
  const folderIds = new Set(sanitized.folders.map((folder) => folder.id));
  const projectsByFolderId = new Map<string, SidebarProjectSnapshot[]>();
  const unfiledProjects: SidebarProjectSnapshot[] = [];

  for (const project of input.projects) {
    const folderId = resolveSidebarProjectFolderId(project, sanitized.assignments, folderIds);
    if (!folderId) {
      unfiledProjects.push(project);
      continue;
    }
    const existing = projectsByFolderId.get(folderId);
    if (existing) {
      existing.push(project);
    } else {
      projectsByFolderId.set(folderId, [project]);
    }
  }

  const buckets: SidebarProjectFolderBucket[] = orderFolders(
    sanitized.folders,
    sanitized.folderOrder,
  ).flatMap((folder) => {
    const projects = projectsByFolderId.get(folder.id) ?? [];
    if (projects.length === 0) return [];
    return [
      {
        id: folder.id,
        name: folder.name,
        color: folder.color,
        kind: "folder" as const,
        projects,
      },
    ];
  });

  if (unfiledProjects.length > 0) {
    buckets.push({
      id: UNFILED_PROJECT_FOLDER_ID,
      name: "Projects",
      color: null,
      kind: "unfiled",
      projects: unfiledProjects,
    });
  }

  return buckets;
}

export function assignSidebarProjectToFolder(input: {
  readonly assignments: Readonly<Record<string, string>>;
  readonly project: SidebarProjectSnapshot;
  readonly folderId: string | null;
}): Record<string, string> {
  const nextAssignments = { ...input.assignments };
  for (const member of input.project.memberProjects) {
    if (input.folderId === null) {
      delete nextAssignments[member.physicalProjectKey];
    } else {
      nextAssignments[member.physicalProjectKey] = input.folderId;
    }
  }
  return nextAssignments;
}

export function sanitizeSidebarProjectFolders(input: {
  readonly folders: readonly SidebarProjectFolder[];
  readonly folderOrder: readonly string[];
  readonly assignments: Readonly<Record<string, string>>;
}): {
  readonly folders: SidebarProjectFolder[];
  readonly folderOrder: string[];
  readonly assignments: Record<string, string>;
} {
  const seenFolderIds = new Set<string>();
  const folders: SidebarProjectFolder[] = [];
  for (const folder of input.folders) {
    const id = folder.id.trim();
    const name = folder.name.trim();
    if (!id || !name || seenFolderIds.has(id) || !isSidebarProjectFolderColor(folder.color)) {
      continue;
    }
    seenFolderIds.add(id);
    folders.push({
      id,
      name,
      color: folder.color,
    });
  }

  const folderOrder = [
    ...new Set(input.folderOrder.filter((folderId) => seenFolderIds.has(folderId))),
  ];
  const assignments = Object.fromEntries(
    Object.entries(input.assignments).filter(
      (entry): entry is [string, string] =>
        entry[0].length > 0 && entry[1].length > 0 && seenFolderIds.has(entry[1]),
    ),
  );

  return { folders, folderOrder, assignments };
}

export function createDefaultSidebarProjectFolder(input: {
  readonly id: string;
  readonly name?: string;
  readonly color?: SidebarProjectFolderColor;
}): SidebarProjectFolder {
  return {
    id: input.id,
    name: input.name?.trim() || "New folder",
    color: input.color ?? DEFAULT_SIDEBAR_PROJECT_FOLDER_COLOR,
  };
}
