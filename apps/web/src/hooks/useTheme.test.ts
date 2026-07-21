import { afterEach, describe, expect, it, vi } from "vite-plus/test";

function createStorage(overrides: Partial<Storage> = {}): Storage {
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
    ...overrides,
  };
}

function createMockReact() {
  let readSnapshot: (() => unknown) | undefined;
  let subscribeToTheme: ((listener: () => void) => () => void) | undefined;
  vi.doMock("react", () => ({
    useCallback: <A>(callback: A) => callback,
    useEffect: () => undefined,
    useSyncExternalStore: (
      subscribe: (listener: () => void) => () => void,
      getSnapshot: () => unknown,
    ) => {
      subscribeToTheme = subscribe;
      readSnapshot = getSnapshot;
      return getSnapshot();
    },
  }));
  return {
    getReadSnapshot: () => readSnapshot,
    getSubscribe: () => subscribeToTheme,
  };
}

interface DocumentStubOptions {
  readonly matchMediaMatches?: boolean;
  readonly initialTheme?: string;
  readonly initialPalette?: string;
  readonly initialCustomPalettes?: string | null;
}

function setupDocumentEnvironment(options: DocumentStubOptions = {}) {
  const storage = createStorage({
    getItem: (key) => {
      if (key === "t3code:theme") return options.initialTheme ?? null;
      if (key === "t3code:theme-palette") return options.initialPalette ?? null;
      if (key === "t3code:theme-palettes-custom") return options.initialCustomPalettes ?? null;
      return null;
    },
  });
  const setProperty = vi.fn();
  const removeProperty = vi.fn();
  const classListToggle = vi.fn();
  const metaSetAttribute = vi.fn();
  const headAppend = vi.fn();
  const bodySetProperty = vi.fn();
  const querySelector = (selector: string) => {
    if (selector.startsWith('meta[name="theme-color"]')) {
      return { setAttribute: metaSetAttribute };
    }
    return null;
  };
  const createElement = vi.fn((tag: string) => {
    if (tag === "meta") {
      return {
        name: "",
        setAttribute: vi.fn(),
      };
    }
    return {};
  });
  vi.stubGlobal("window", {
    localStorage: storage,
    matchMedia: () => ({
      matches: options.matchMediaMatches ?? false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  vi.stubGlobal("document", {
    documentElement: {
      classList: { toggle: classListToggle },
      style: { setProperty, removeProperty },
    },
    head: { append: headAppend },
    body: { style: { setProperty: bodySetProperty } },
    querySelector,
    createElement,
  });
  const originalGetComputedStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (() =>
    ({
      backgroundColor: "rgb(0, 0, 0)",
    }) as unknown as CSSStyleDeclaration) as typeof getComputedStyle;
  return {
    setProperty,
    removeProperty,
    classListToggle,
    metaSetAttribute,
    headAppend,
    bodySetProperty,
    createElement,
    storage,
    restore: () => {
      globalThis.getComputedStyle = originalGetComputedStyle;
    },
  };
}

afterEach(() => {
  vi.doUnmock("react");
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("theme failure handling", () => {
  it("preserves exact storage causes and operation context", async () => {
    const readCause = new Error("storage read blocked");
    const writeCause = new Error("storage quota exceeded");
    vi.stubGlobal("window", {
      localStorage: createStorage({
        getItem: () => {
          throw readCause;
        },
        setItem: () => {
          throw writeCause;
        },
      }),
    });

    const { readThemePreference, ThemeStorageError, writeThemePreference } =
      await import("./useTheme");

    try {
      readThemePreference();
      expect.unreachable("expected the theme read to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ThemeStorageError);
      expect(error).toMatchObject({
        operation: "read",
        storageKey: "t3code:theme",
        cause: readCause,
      });
    }

    try {
      writeThemePreference("dark");
      expect.unreachable("expected the theme write to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ThemeStorageError);
      expect(error).toMatchObject({
        operation: "write",
        storageKey: "t3code:theme",
        theme: "dark",
        cause: writeCause,
      });
    }
  });

  it("falls back during initial theme application and logs only safe attributes", async () => {
    const cause = new Error("private browsing storage failure");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const storageFailure = createStorage({
      getItem: () => {
        throw cause;
      },
    });
    vi.stubGlobal("window", {
      localStorage: storageFailure,
      matchMedia: () => ({ matches: false, addEventListener: () => undefined }),
    });
    vi.stubGlobal("document", {
      documentElement: {
        classList: { toggle: vi.fn() },
        style: { setProperty: vi.fn(), removeProperty: vi.fn() },
      },
      head: { append: vi.fn() },
      body: { style: { setProperty: vi.fn() } },
      querySelector: () => null,
      createElement: () => ({ setAttribute: vi.fn() }),
    });
    const originalGetComputedStyle = globalThis.getComputedStyle;
    globalThis.getComputedStyle = (() =>
      ({
        backgroundColor: "rgb(0,0,0)",
      }) as unknown as CSSStyleDeclaration) as typeof getComputedStyle;

    try {
      await expect(import("./useTheme")).resolves.toBeDefined();

      expect(errorLog).toHaveBeenCalledWith(
        "Failed to read theme preference for t3code:theme.",
        expect.objectContaining({
          operation: "read",
          storageKey: "t3code:theme",
          errorTag: "ThemeStorageError",
        }),
      );
      const attributes = errorLog.mock.calls[0]?.[1];
      expect(attributes).not.toHaveProperty("cause");
      expect(JSON.stringify(attributes)).not.toContain(cause.message);
    } finally {
      globalThis.getComputedStyle = originalGetComputedStyle;
    }
  });

  it("retries a failed storage read only after a relevant storage event", async () => {
    const cause = new Error("persistent storage failure");
    const getItem = vi.fn(() => {
      throw cause;
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const { getReadSnapshot, getSubscribe } = createMockReact();
    let storageHandler: ((event: StorageEvent) => void) | undefined;
    vi.stubGlobal("window", {
      addEventListener: (type: string, listener: (event: StorageEvent) => void) => {
        if (type === "storage") storageHandler = listener;
      },
      localStorage: createStorage({ getItem }),
      matchMedia: () => ({
        matches: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
      removeEventListener: () => undefined,
    });
    vi.stubGlobal("document", {
      documentElement: {
        classList: { toggle: vi.fn() },
        style: { setProperty: vi.fn(), removeProperty: vi.fn() },
      },
      head: { append: vi.fn() },
      body: { style: { setProperty: vi.fn() } },
      querySelector: () => null,
      createElement: () => ({ setAttribute: vi.fn() }),
    });
    const originalGetComputedStyle = globalThis.getComputedStyle;
    globalThis.getComputedStyle = (() =>
      ({
        backgroundColor: "rgb(0,0,0)",
      }) as unknown as CSSStyleDeclaration) as typeof getComputedStyle;

    try {
      const { useTheme } = await import("./useTheme");
      useTheme();
      const readSnapshot = getReadSnapshot();
      const errorLogCountAfterMount = errorLog.mock.calls.length;
      const getItemCountAfterMount = getItem.mock.calls.length;

      const subscribe = getSubscribe();
      const unsubscribe = subscribe?.(() => undefined);

      // A storage event for the theme key retries the read; the error count grows.
      storageHandler?.({ key: "t3code:theme" } as StorageEvent);
      expect(getItem.mock.calls.length).toBeGreaterThan(getItemCountAfterMount);
      expect(errorLog.mock.calls.length).toBeGreaterThan(errorLogCountAfterMount);

      // Unrelated storage events must not trigger a retry.
      const errorLogBeforeUnrelated = errorLog.mock.calls.length;
      const getItemBeforeUnrelated = getItem.mock.calls.length;
      storageHandler?.({ key: "unrelated-key" } as StorageEvent);
      expect(getItem.mock.calls.length).toBe(getItemBeforeUnrelated);
      expect(errorLog.mock.calls.length).toBe(errorLogBeforeUnrelated);

      // Touch readSnapshot to ensure the component is still subscribed.
      readSnapshot?.();
      unsubscribe?.();
    } finally {
      globalThis.getComputedStyle = originalGetComputedStyle;
    }
  });

  it("preserves desktop sync causes and retries after a failed cosmetic sync", async () => {
    const cause = new Error("desktop IPC unavailable");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const setTheme = vi.fn().mockRejectedValue(cause);
    vi.stubGlobal("window", { desktopBridge: { setTheme } });

    const { DesktopThemeSyncError, syncDesktopTheme, syncDesktopThemePreference } =
      await import("./useTheme");

    const error = await syncDesktopThemePreference({ setTheme }, "dark").then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(DesktopThemeSyncError);
    expect(error).toMatchObject({ theme: "dark", cause });

    setTheme.mockClear();
    syncDesktopTheme("dark");
    await Promise.resolve();
    await Promise.resolve();
    syncDesktopTheme("dark");
    await Promise.resolve();
    await Promise.resolve();

    expect(setTheme).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalledWith(
      "Failed to sync the dark theme to the desktop shell.",
      expect.objectContaining({
        theme: "dark",
        errorTag: "DesktopThemeSyncError",
      }),
    );
    for (const [, attributes] of errorLog.mock.calls) {
      expect(attributes).not.toHaveProperty("cause");
      expect(JSON.stringify(attributes)).not.toContain(cause.message);
    }
  });
});

describe("theme palette handling", () => {
  it("normalizes imported theme colors and rejects malformed hex values", async () => {
    const { normalizeThemeColors, normalizeThemeHex } = await import("../theme/palettes");
    expect(normalizeThemeHex("#FFFFFF")).toBe("#ffffff");
    expect(normalizeThemeHex(" #abcdef ")).toBe("#abcdef");
    expect(normalizeThemeHex("#xyz123")).toBeUndefined();
    expect(normalizeThemeHex("#1234")).toBeUndefined();
    expect(normalizeThemeHex(undefined)).toBeUndefined();

    expect(
      normalizeThemeColors({
        accent: "#cc7d5e",
        background: "#2d2d2b",
        foreground: "#f9f9f7",
        sidebar: "#1f1f1d",
      }),
    ).toEqual({
      accent: "#cc7d5e",
      background: "#2d2d2b",
      foreground: "#f9f9f7",
      sidebar: "#1f1f1d",
    });
    expect(
      normalizeThemeColors({
        accent: "not-a-color",
        background: "#2d2d2b",
        foreground: "#f9f9f7",
        sidebar: "#1f1f1d",
      }),
    ).toBeUndefined();
    expect(
      normalizeThemeColors({
        accent: "#cc7d5e",
        background: "#2d2d2b",
        foreground: "#f9f9f7",
        sidebar: "not-a-color",
      }),
    ).toBeUndefined();
    expect(normalizeThemeColors(undefined)).toBeUndefined();
  });

  it("falls back to the default palette when the stored id is unknown", async () => {
    setupDocumentEnvironment({ initialPalette: "missing-palette" });
    const { readPalettePreference } = await import("./useTheme");
    expect(readPalettePreference()).toBe("default");
  });

  it("applies the dark palette to the document root when the dark theme is active", async () => {
    createMockReact();
    const { setProperty, restore } = setupDocumentEnvironment({ initialTheme: "dark" });

    try {
      const { useTheme } = await import("./useTheme");
      const snapshot = useTheme();
      expect(snapshot.paletteId).toBe("default");
      expect(snapshot.paletteColors).toEqual({
        accent: "#cc7d5e",
        background: "#2d2d2b",
        foreground: "#f9f9f7",
        sidebar: "#1f1f1d",
      });
      expect(snapshot.palette.name).toBe("Dark theme");

      const setByName = (name: string) =>
        setProperty.mock.calls.find(([property]) => property === name)?.[1];

      expect(setByName("--background")).toBe("#2d2d2b");
      expect(setByName("--foreground")).toBe("#f9f9f7");
      expect(setByName("--app-chrome-background")).toBe("#2d2d2b");
      expect(setByName("--theme-accent")).toBe("#cc7d5e");
      expect(setByName("--sidebar")).toBe("#1f1f1d");
    } finally {
      restore();
    }
  });

  it("clears the palette CSS overrides when the resolved theme is light and no light palette is defined", async () => {
    const { removeProperty, restore } = setupDocumentEnvironment();

    try {
      await import("./useTheme");

      const removed = new Set(removeProperty.mock.calls.map(([name]) => name));
      expect(removed.has("--background")).toBe(true);
      expect(removed.has("--foreground")).toBe(true);
      expect(removed.has("--app-chrome-background")).toBe(true);
      expect(removed.has("--theme-accent")).toBe(true);
      expect(removed.has("--sidebar")).toBe(true);
    } finally {
      restore();
    }
  });

  it("reads custom palettes from storage and reflects them in the snapshot", async () => {
    createMockReact();
    const customPalette = {
      default: {
        id: "default",
        name: "Dark theme",
        glyph: "Aa",
        fontStyle: "sans",
        dark: {
          accent: "#123456",
          background: "#000000",
          foreground: "#ffffff",
          sidebar: "#0a0a0a",
        },
      },
    };
    const env = setupDocumentEnvironment({
      initialTheme: "dark",
      initialCustomPalettes: JSON.stringify(customPalette),
    });

    try {
      const { useTheme } = await import("./useTheme");
      const snapshot = useTheme();
      expect(snapshot.paletteId).toBe("default");
      expect(snapshot.paletteColors.accent).toBe("#123456");
      expect(snapshot.paletteColors.background).toBe("#000000");
      expect(snapshot.paletteColors.foreground).toBe("#ffffff");
      expect(snapshot.paletteColors.sidebar).toBe("#0a0a0a");
    } finally {
      env.restore();
    }
  });

  it("rejects custom palettes with missing or malformed colors", async () => {
    createMockReact();
    const malformed = {
      default: {
        id: "default",
        name: "Dark theme",
        glyph: "Aa",
        fontStyle: "sans",
        dark: {
          accent: "not-a-hex",
          background: "#000000",
          foreground: "#ffffff",
          sidebar: "#0a0a0a",
        },
      },
    };
    const env = setupDocumentEnvironment({
      initialTheme: "dark",
      initialCustomPalettes: JSON.stringify(malformed),
    });

    try {
      const { useTheme } = await import("./useTheme");
      const snapshot = useTheme();
      // Malformed custom palette is skipped; the built-in default takes over.
      expect(snapshot.paletteColors.accent).toBe("#cc7d5e");
      expect(snapshot.paletteColors.sidebar).toBe("#1f1f1d");
    } finally {
      env.restore();
    }
  });
});
