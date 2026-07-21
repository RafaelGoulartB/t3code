/**
 * Produces a stable key for comparing paths received from Git and thread metadata.
 * Windows paths are case-insensitive; POSIX paths intentionally are not.
 */
export function normalizeWorktreePath(path: string | null | undefined): string | null {
  const trimmed = path?.trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalized.length === 0) return "/";
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
}
