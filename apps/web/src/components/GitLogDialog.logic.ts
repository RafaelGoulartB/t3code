export function formatRelativeGitCommitDate(value: string, nowMs = Date.now()): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "Unknown date";
  }

  const elapsedSeconds = Math.round((timestamp - nowMs) / 1_000);
  const units: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  const [unit, seconds] = units.find(([, seconds]) => Math.abs(elapsedSeconds) >= seconds) ?? [
    "second",
    1,
  ];
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    Math.round(elapsedSeconds / seconds),
    unit,
  );
}
