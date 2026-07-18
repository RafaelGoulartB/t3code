import { describe, expect, it } from "vite-plus/test";

import { getPreviewPanelMaxWidth } from "./PreviewPanelShell";

describe("getPreviewPanelMaxWidth", () => {
  it("allows the panel to use the full ultra-wide viewport", () => {
    expect(getPreviewPanelMaxWidth(6_000)).toBe(6_000);
  });

  it("preserves the viewport width", () => {
    expect(getPreviewPanelMaxWidth(2_001)).toBe(2_001);
  });
});
