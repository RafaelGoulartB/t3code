import type { DesktopBridge } from "@t3tools/contracts";
import { safeErrorLogAttributes } from "@t3tools/client-runtime/errors";
import * as Schema from "effect/Schema";
import { useCallback, useEffect, useSyncExternalStore } from "react";

import {
  BUILTIN_PALETTES,
  DEFAULT_PALETTE_ID,
  getBuiltinPalette,
  isPaletteEqual,
  listBuiltinPalettes,
  normalizeThemeColors,
  normalizeThemeHex,
  resolvePaletteColors,
  type ThemeColors,
  type ThemePalette,
} from "../theme/palettes";

const ThemePreference = Schema.Literals(["light", "dark", "system"]);
type Theme = typeof ThemePreference.Type;
type ThemeSnapshot = {
  theme: Theme;
  systemDark: boolean;
  paletteId: string;
  palette: ThemePalette;
  paletteColors: ThemeColors;
  resolvedTheme: "light" | "dark";
};

type DesktopThemeBridge = Pick<DesktopBridge, "setTheme">;

const STORAGE_KEY = "t3code:theme";
const PALETTE_STORAGE_KEY = "t3code:theme-palette";
const CUSTOM_PALETTES_STORAGE_KEY = "t3code:theme-palettes-custom";
const MEDIA_QUERY = "(prefers-color-scheme: dark)";
const DEFAULT_THEME_SNAPSHOT: ThemeSnapshot = (() => {
  const palette = BUILTIN_PALETTES[DEFAULT_PALETTE_ID]!;
  return {
    theme: "system",
    systemDark: false,
    paletteId: DEFAULT_PALETTE_ID,
    palette,
    paletteColors: resolvePaletteColors(palette, "light"),
    resolvedTheme: "light",
  };
})();
const THEME_COLOR_META_NAME = "theme-color";
const DYNAMIC_THEME_COLOR_SELECTOR = `meta[name="${THEME_COLOR_META_NAME}"][data-dynamic-theme-color="true"]`;

export class ThemeStorageError extends Schema.TaggedErrorClass<ThemeStorageError>()(
  "ThemeStorageError",
  {
    operation: Schema.Literals(["read", "write"]),
    storageKey: Schema.String,
    theme: Schema.optional(ThemePreference),
    paletteId: Schema.optional(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} theme preference for ${this.storageKey}.`;
  }
}

export const isThemeStorageError = Schema.is(ThemeStorageError);

export class DesktopThemeSyncError extends Schema.TaggedErrorClass<DesktopThemeSyncError>()(
  "DesktopThemeSyncError",
  {
    theme: ThemePreference,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to sync the ${this.theme} theme to the desktop shell.`;
  }
}

export const isDesktopThemeSyncError = Schema.is(DesktopThemeSyncError);

let listeners: Array<() => void> = [];
let lastSnapshot: ThemeSnapshot | null = null;
let lastDesktopTheme: Theme | null = null;
let lastAppliedTheme: ThemeSnapshot["theme"] | null = null;
let lastAppliedSystemDark = false;
let lastAppliedPaletteColors: ThemeColors | null = null;
let themeStorageReadFailure: ThemeStorageError | null = null;
let customPalettesCache: Record<string, ThemePalette> | null = null;

function emitChange() {
  for (const listener of listeners) listener();
}

function getSystemDark() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MEDIA_QUERY).matches
  );
}

function readCustomPalettes(): Record<string, ThemePalette> {
  if (customPalettesCache) return customPalettesCache;
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CUSTOM_PALETTES_STORAGE_KEY);
    if (!raw) {
      customPalettesCache = {};
      return customPalettesCache;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      customPalettesCache = {};
      return customPalettesCache;
    }
    const next: Record<string, ThemePalette> = {};
    for (const [id, candidate] of Object.entries(parsed as Record<string, unknown>)) {
      if (!candidate || typeof candidate !== "object") continue;
      const palette = candidate as Partial<ThemePalette>;
      if (
        typeof palette.id !== "string" ||
        typeof palette.name !== "string" ||
        typeof palette.glyph !== "string" ||
        (palette.fontStyle !== "sans" &&
          palette.fontStyle !== "serif" &&
          palette.fontStyle !== "mono") ||
        !palette.dark
      ) {
        continue;
      }
      const dark = normalizeThemeColors(palette.dark);
      if (!dark) continue;
      const light = palette.light ? normalizeThemeColors(palette.light) : undefined;
      next[id] = {
        id: palette.id,
        name: palette.name,
        glyph: palette.glyph,
        fontStyle: palette.fontStyle,
        dark,
        ...(light ? { light } : {}),
      };
    }
    customPalettesCache = next;
    return next;
  } catch {
    customPalettesCache = {};
    return customPalettesCache;
  }
}

function writeCustomPalettes(palettes: Record<string, ThemePalette>): void {
  customPalettesCache = palettes;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CUSTOM_PALETTES_STORAGE_KEY, JSON.stringify(palettes));
  } catch (cause) {
    throw new ThemeStorageError({
      operation: "write",
      storageKey: CUSTOM_PALETTES_STORAGE_KEY,
      cause,
    });
  }
}

export function listAllPalettes(): ThemePalette[] {
  const customs = Object.values(readCustomPalettes());
  return [...listBuiltinPalettes(), ...customs];
}

export function resolvePalette(id: string): ThemePalette {
  const customs = readCustomPalettes();
  const custom = customs[id];
  if (custom) return custom;
  const builtin = getBuiltinPalette(id);
  if (builtin) return builtin;
  return BUILTIN_PALETTES[DEFAULT_PALETTE_ID]!;
}

export function readThemePreference(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME_SNAPSHOT.theme;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch (cause) {
    throw new ThemeStorageError({
      operation: "read",
      storageKey: STORAGE_KEY,
      cause,
    });
  }
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return DEFAULT_THEME_SNAPSHOT.theme;
}

export function writeThemePreference(theme: Theme): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
    themeStorageReadFailure = null;
  } catch (cause) {
    throw new ThemeStorageError({
      operation: "write",
      storageKey: STORAGE_KEY,
      theme,
      cause,
    });
  }
}

export function readPalettePreference(): string {
  if (typeof window === "undefined") return DEFAULT_THEME_SNAPSHOT.paletteId;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(PALETTE_STORAGE_KEY);
  } catch (cause) {
    throw new ThemeStorageError({
      operation: "read",
      storageKey: PALETTE_STORAGE_KEY,
      cause,
    });
  }
  if (raw && typeof raw === "string") {
    if (getBuiltinPalette(raw) || readCustomPalettes()[raw]) {
      return raw;
    }
  }
  return DEFAULT_THEME_SNAPSHOT.paletteId;
}

export function writePalettePreference(paletteId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PALETTE_STORAGE_KEY, paletteId);
    themeStorageReadFailure = null;
  } catch (cause) {
    throw new ThemeStorageError({
      operation: "write",
      storageKey: PALETTE_STORAGE_KEY,
      paletteId,
      cause,
    });
  }
}

export function saveCustomPalette(palette: ThemePalette): void {
  const custom = { ...readCustomPalettes(), [palette.id]: palette };
  writeCustomPalettes(custom);
}

export function deleteCustomPalette(paletteId: string): void {
  const custom = { ...readCustomPalettes() };
  delete custom[paletteId];
  writeCustomPalettes(custom);
  if (readPalettePreference() === paletteId) {
    writePalettePreference(DEFAULT_PALETTE_ID);
  }
}

function getStored(): Theme {
  if (themeStorageReadFailure !== null) {
    return DEFAULT_THEME_SNAPSHOT.theme;
  }
  try {
    return readThemePreference();
  } catch (cause) {
    const error = isThemeStorageError(cause)
      ? cause
      : new ThemeStorageError({
          operation: "read",
          storageKey: STORAGE_KEY,
          cause,
        });
    themeStorageReadFailure = error;
    console.error(error.message, {
      operation: error.operation,
      storageKey: error.storageKey,
      ...safeErrorLogAttributes(error),
    });
    return DEFAULT_THEME_SNAPSHOT.theme;
  }
}

function getStoredPaletteId(): string {
  try {
    return readPalettePreference();
  } catch (cause) {
    const error = isThemeStorageError(cause)
      ? cause
      : new ThemeStorageError({
          operation: "read",
          storageKey: PALETTE_STORAGE_KEY,
          cause,
        });
    themeStorageReadFailure = error;
    console.error(error.message, {
      operation: error.operation,
      storageKey: error.storageKey,
      ...safeErrorLogAttributes(error),
    });
    return DEFAULT_THEME_SNAPSHOT.paletteId;
  }
}

function ensureThemeColorMetaTag(): HTMLMetaElement {
  let element = document.querySelector<HTMLMetaElement>(DYNAMIC_THEME_COLOR_SELECTOR);
  if (element) {
    return element;
  }

  element = document.createElement("meta");
  element.name = THEME_COLOR_META_NAME;
  element.setAttribute("data-dynamic-theme-color", "true");
  document.head.append(element);
  return element;
}

function normalizeThemeColor(value: string | null | undefined): string | null {
  const normalizedValue = value?.trim().toLowerCase();
  if (
    !normalizedValue ||
    normalizedValue === "transparent" ||
    normalizedValue === "rgba(0, 0, 0, 0)" ||
    normalizedValue === "rgba(0 0 0 / 0)"
  ) {
    return null;
  }

  return value?.trim() ?? null;
}

function resolveBrowserChromeSurface(): HTMLElement {
  return (
    document.querySelector<HTMLElement>("main[data-slot='sidebar-inset']") ??
    document.querySelector<HTMLElement>("[data-slot='sidebar-inner']") ??
    document.body
  );
}

function applyPaletteToDocument(
  palette: ThemePalette,
  resolvedTheme: "light" | "dark",
): ThemeColors {
  const root: HTMLElement | null =
    typeof document !== "undefined" ? document.documentElement : null;
  const style = root?.style;
  const hasLight = Boolean(palette.light);
  if (resolvedTheme === "light" && !hasLight) {
    style?.removeProperty("--background");
    style?.removeProperty("--foreground");
    style?.removeProperty("--app-chrome-background");
    style?.removeProperty("--theme-accent");
    return {
      accent: "",
      background: "",
      foreground: "",
    };
  }
  const colors = resolvePaletteColors(palette, resolvedTheme);
  style?.setProperty("--background", colors.background);
  style?.setProperty("--foreground", colors.foreground);
  style?.setProperty("--app-chrome-background", colors.background);
  style?.setProperty("--theme-accent", colors.accent);
  return colors;
}

export function syncBrowserChromeTheme() {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") return;
  const surfaceColor = normalizeThemeColor(
    getComputedStyle(resolveBrowserChromeSurface()).backgroundColor,
  );
  const fallbackColor = normalizeThemeColor(getComputedStyle(document.body).backgroundColor);
  const backgroundColor = surfaceColor ?? fallbackColor;
  if (!backgroundColor) return;

  document.documentElement.style.backgroundColor = backgroundColor;
  document.body.style.backgroundColor = backgroundColor;
  ensureThemeColorMetaTag().setAttribute("content", backgroundColor);
}

function applyTheme(theme: Theme, suppressTransitions = false) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const systemDark = theme === "system" ? getSystemDark() : false;
  const palette = resolvePalette(getStoredPaletteId());
  const resolvedTheme: "light" | "dark" =
    theme === "dark" || (theme === "system" && systemDark) ? "dark" : "light";
  const paletteColors = applyPaletteToDocument(palette, resolvedTheme);

  if (
    lastAppliedTheme === theme &&
    lastAppliedSystemDark === systemDark &&
    lastAppliedPaletteColors &&
    isPaletteEqual(lastAppliedPaletteColors, paletteColors)
  ) {
    syncDesktopTheme(theme);
    return;
  }

  if (suppressTransitions) {
    document.documentElement.classList.add("no-transitions");
  }
  const isDark = resolvedTheme === "dark";
  document.documentElement.classList.toggle("dark", isDark);
  lastAppliedTheme = theme;
  lastAppliedSystemDark = systemDark;
  lastAppliedPaletteColors = paletteColors;
  syncBrowserChromeTheme();
  syncDesktopTheme(theme);
  if (suppressTransitions) {
    // Force a reflow so the no-transitions class takes effect before removal
    // oxlint-disable-next-line no-unused-expressions
    document.documentElement.offsetHeight;
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("no-transitions");
    });
  }
}

export async function syncDesktopThemePreference(
  bridge: DesktopThemeBridge,
  theme: Theme,
): Promise<void> {
  try {
    await bridge.setTheme(theme);
  } catch (cause) {
    throw new DesktopThemeSyncError({ theme, cause });
  }
}

export function syncDesktopTheme(theme: Theme) {
  if (typeof window === "undefined") return;
  const bridge = window.desktopBridge;
  if (!bridge || typeof bridge.setTheme !== "function" || lastDesktopTheme === theme) {
    return;
  }

  lastDesktopTheme = theme;
  void syncDesktopThemePreference(bridge, theme).catch((cause: unknown) => {
    const error = isDesktopThemeSyncError(cause)
      ? cause
      : new DesktopThemeSyncError({ theme, cause });
    console.error(error.message, {
      theme: error.theme,
      ...safeErrorLogAttributes(error),
    });
    if (lastDesktopTheme === theme) {
      lastDesktopTheme = null;
    }
  });
}

// Apply immediately on module load to prevent flash
if (typeof document !== "undefined" && typeof window !== "undefined") {
  applyTheme(getStored());
}

function getSnapshot(): ThemeSnapshot {
  if (typeof window === "undefined") return DEFAULT_THEME_SNAPSHOT;
  const theme = getStored();
  const systemDark = theme === "system" ? getSystemDark() : false;
  const paletteId = getStoredPaletteId();
  const palette = resolvePalette(paletteId);
  const resolvedTheme: "light" | "dark" =
    theme === "dark" || (theme === "system" && systemDark) ? "dark" : "light";
  const paletteColors = resolvePaletteColors(palette, resolvedTheme);

  if (
    lastSnapshot &&
    lastSnapshot.theme === theme &&
    lastSnapshot.systemDark === systemDark &&
    lastSnapshot.paletteId === paletteId &&
    isPaletteEqual(lastSnapshot.paletteColors, paletteColors)
  ) {
    return lastSnapshot;
  }

  lastSnapshot = { theme, systemDark, paletteId, palette, paletteColors, resolvedTheme };
  return lastSnapshot;
}

function getServerSnapshot() {
  return DEFAULT_THEME_SNAPSHOT;
}

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  listeners.push(listener);

  // Listen for system preference changes
  const mq = typeof window.matchMedia === "function" ? window.matchMedia(MEDIA_QUERY) : null;
  const handleChange = () => {
    if (getStored() === "system") applyTheme("system", true);
    emitChange();
  };
  mq?.addEventListener("change", handleChange);

  // Listen for storage changes from other tabs
  const handleStorage = (e: StorageEvent) => {
    if (
      e.key === STORAGE_KEY ||
      e.key === PALETTE_STORAGE_KEY ||
      e.key === CUSTOM_PALETTES_STORAGE_KEY
    ) {
      themeStorageReadFailure = null;
      if (e.key === CUSTOM_PALETTES_STORAGE_KEY) {
        customPalettesCache = null;
      }
      applyTheme(getStored(), true);
      emitChange();
    }
  };
  window.addEventListener("storage", handleStorage);

  return () => {
    listeners = listeners.filter((l) => l !== listener);
    mq?.removeEventListener("change", handleChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const theme = snapshot.theme;
  const paletteId = snapshot.paletteId;
  const palette = snapshot.palette;
  const paletteColors = snapshot.paletteColors;

  const setTheme = useCallback((next: Theme) => {
    if (typeof window === "undefined") return;
    try {
      writeThemePreference(next);
    } catch (cause) {
      const error = isThemeStorageError(cause)
        ? cause
        : new ThemeStorageError({
            operation: "write",
            storageKey: STORAGE_KEY,
            theme: next,
            cause,
          });
      console.error(error.message, {
        operation: error.operation,
        storageKey: error.storageKey,
        theme: next,
        ...safeErrorLogAttributes(error),
      });
      return;
    }
    applyTheme(next, true);
    emitChange();
  }, []);

  const setPalette = useCallback((nextId: string | null) => {
    if (typeof window === "undefined") return;
    if (typeof nextId !== "string" || nextId.length === 0) return;
    const resolved = resolvePalette(nextId);
    try {
      writePalettePreference(resolved.id);
    } catch (cause) {
      const error = isThemeStorageError(cause)
        ? cause
        : new ThemeStorageError({
            operation: "write",
            storageKey: PALETTE_STORAGE_KEY,
            paletteId: resolved.id,
            cause,
          });
      console.error(error.message, {
        operation: error.operation,
        storageKey: error.storageKey,
        paletteId: resolved.id,
        ...safeErrorLogAttributes(error),
      });
      return;
    }
    applyTheme(getStored(), true);
    emitChange();
  }, []);

  const setPaletteColor = useCallback(
    (field: "accent" | "background" | "foreground", value: string) => {
      if (typeof window === "undefined") return;
      const normalized = normalizeThemeHex(value);
      if (!normalized) return;
      const base = readCustomPalettes()[paletteId] ?? palette;
      const nextDark = { ...base.dark, [field]: normalized };
      const nextLight = base.light ? { ...base.light, [field]: normalized } : undefined;
      const next: ThemePalette = {
        ...base,
        dark: nextDark,
        ...(nextLight ? { light: nextLight } : {}),
      };
      try {
        saveCustomPalette(next);
        writePalettePreference(next.id);
      } catch (cause) {
        const error = isThemeStorageError(cause)
          ? cause
          : new ThemeStorageError({
              operation: "write",
              storageKey: CUSTOM_PALETTES_STORAGE_KEY,
              paletteId: next.id,
              cause,
            });
        console.error(error.message, {
          operation: error.operation,
          storageKey: error.storageKey,
          paletteId: next.id,
          ...safeErrorLogAttributes(error),
        });
        return;
      }
      applyTheme(getStored(), true);
      emitChange();
    },
    [paletteId, palette],
  );

  const resetPalette = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      if (readCustomPalettes()[paletteId]) {
        deleteCustomPalette(paletteId);
      }
      writePalettePreference(DEFAULT_PALETTE_ID);
    } catch (cause) {
      const error = isThemeStorageError(cause)
        ? cause
        : new ThemeStorageError({
            operation: "write",
            storageKey: PALETTE_STORAGE_KEY,
            paletteId: DEFAULT_PALETTE_ID,
            cause,
          });
      console.error(error.message, {
        operation: error.operation,
        storageKey: error.storageKey,
        paletteId: DEFAULT_PALETTE_ID,
        ...safeErrorLogAttributes(error),
      });
      return;
    }
    applyTheme(getStored(), true);
    emitChange();
  }, [paletteId]);

  // Keep DOM in sync on mount/change
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return {
    theme,
    setTheme,
    resolvedTheme: snapshot.resolvedTheme,
    palette,
    paletteId,
    paletteColors,
    setPalette,
    setPaletteColor,
    resetPalette,
    availablePalettes: listAllPalettes(),
  } as const;
}
