import { createFileRoute } from "@tanstack/react-router";

import { AdvancedSettingsPanel } from "../components/settings/AdvancedSettings";

export const Route = createFileRoute("/settings/advanced")({
  component: AdvancedSettingsPanel,
});
