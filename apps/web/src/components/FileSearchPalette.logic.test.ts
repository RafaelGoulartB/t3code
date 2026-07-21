import { describe, expect, it } from "vite-plus/test";

import { filePathLabel, fileSearchPaths, recentFileSearchPaths } from "./FileSearchPalette.logic";

describe("fileSearchPaths", () => {
  it("keeps the index ranking, excludes directories, and limits visible results", () => {
    const paths = fileSearchPaths([
      { path: "src", kind: "directory" },
      { path: "src/main.ts", kind: "file" },
      { path: "README.md", kind: "file" },
      { path: "a.ts", kind: "file" },
      { path: "b.ts", kind: "file" },
      { path: "c.ts", kind: "file" },
      { path: "d.ts", kind: "file" },
      { path: "e.ts", kind: "file" },
      { path: "f.ts", kind: "file" },
      { path: "g.ts", kind: "file" },
      { path: "h.ts", kind: "file" },
    ]);

    expect(paths).toEqual([
      "src/main.ts",
      "README.md",
      "a.ts",
      "b.ts",
      "c.ts",
      "d.ts",
      "e.ts",
      "f.ts",
    ]);
  });
});

describe("recentFileSearchPaths", () => {
  it("deduplicates recent paths and limits the palette to eight", () => {
    expect(
      recentFileSearchPaths([
        "a.ts",
        "a.ts",
        "b.ts",
        "c.ts",
        "d.ts",
        "e.ts",
        "f.ts",
        "g.ts",
        "h.ts",
        "i.ts",
      ]),
    ).toEqual(["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts", "g.ts", "h.ts"]);
  });
});

describe("filePathLabel", () => {
  it("separates a filename from its relative directory", () => {
    expect(filePathLabel("src/components/App.tsx")).toEqual({
      title: "App.tsx",
      description: "src/components",
    });
    expect(filePathLabel("README.md")).toEqual({ title: "README.md", description: "Project root" });
  });
});
