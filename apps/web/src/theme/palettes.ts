export interface ThemeColors {
  accent: string;
  background: string;
  foreground: string;
  sidebar: string;
}

export type ThemeFontStyle = "sans" | "serif" | "mono";

export interface ThemePalette {
  id: string;
  name: string;
  glyph: string;
  fontStyle: ThemeFontStyle;
  dark: ThemeColors;
  light?: ThemeColors;
}

export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/u;

export function normalizeThemeHex(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return HEX_COLOR_PATTERN.test(trimmed) ? trimmed.toLowerCase() : undefined;
}

export function normalizeThemeColors(
  value: Partial<ThemeColors> | undefined | null,
): ThemeColors | undefined {
  if (!value) return undefined;
  const accent = normalizeThemeHex(value.accent);
  const background = normalizeThemeHex(value.background);
  const foreground = normalizeThemeHex(value.foreground);
  const sidebar = normalizeThemeHex(value.sidebar);
  if (!accent || !background || !foreground || !sidebar) return undefined;
  return { accent, background, foreground, sidebar };
}

export const DEFAULT_PALETTE_ID = "default";

export const BUILTIN_PALETTES: Readonly<Record<string, ThemePalette>> = {
  [DEFAULT_PALETTE_ID]: {
    id: DEFAULT_PALETTE_ID,
    name: "Dark theme",
    glyph: "Aa",
    fontStyle: "serif",
    dark: {
      accent: "#cc7d5e",
      background: "#2d2d2b",
      foreground: "#f9f9f7",
      sidebar: "#1f1f1d",
    },
  },
};

export function listBuiltinPalettes(): ThemePalette[] {
  return Object.values(BUILTIN_PALETTES);
}

export function getBuiltinPalette(id: string): ThemePalette | undefined {
  return BUILTIN_PALETTES[id];
}

export function resolvePaletteColors(
  palette: ThemePalette,
  resolvedTheme: "light" | "dark",
): ThemeColors {
  if (resolvedTheme === "light" && palette.light) {
    return palette.light;
  }
  return palette.dark;
}

export function isPaletteEqual(a: ThemeColors, b: ThemeColors): boolean {
  return (
    a.accent === b.accent &&
    a.background === b.background &&
    a.foreground === b.foreground &&
    a.sidebar === b.sidebar
  );
}

export const THEME_COLOR_FIELDS = ["accent", "background", "foreground", "sidebar"] as const;
export type ThemeColorField = (typeof THEME_COLOR_FIELDS)[number];
