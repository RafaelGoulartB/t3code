import { useEffect, useState } from "react";
import { DEFAULT_WORKTREE_BRANCH_PREFIX, normalizeWorktreeBranchPrefix } from "@t3tools/shared/git";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { Input } from "../ui/input";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";

export function AdvancedSettingsPanel() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const [value, setValue] = useState(settings.worktreeBranchPrefix);
  const normalized = normalizeWorktreeBranchPrefix(value);
  const invalid = value.trim().length > 0 && normalized === null;

  useEffect(() => {
    setValue(settings.worktreeBranchPrefix);
  }, [settings.worktreeBranchPrefix]);

  return (
    <SettingsPageContainer>
      <SettingsSection title="Advanced">
        <SettingsRow
          title="Worktree branch prefix"
          description="New worktrees use this prefix followed by an identifier, for example t3code/abcd1234 or life_notes/abcd1234."
          status={
            invalid
              ? "Use letters, numbers, dots, underscores, hyphens, and optional slash-separated namespaces."
              : undefined
          }
          resetAction={
            settings.worktreeBranchPrefix !== DEFAULT_WORKTREE_BRANCH_PREFIX ? (
              <SettingResetButton
                label="worktree branch prefix"
                onClick={() =>
                  updateSettings({ worktreeBranchPrefix: DEFAULT_WORKTREE_BRANCH_PREFIX })
                }
              />
            ) : null
          }
          control={
            <Input
              className="sm:w-64"
              aria-invalid={invalid || undefined}
              aria-label="Worktree branch prefix"
              value={value}
              onValueChange={(next) => {
                setValue(next);
                const validPrefix = normalizeWorktreeBranchPrefix(next);
                if (validPrefix) {
                  updateSettings({ worktreeBranchPrefix: validPrefix });
                }
              }}
              onBlur={() =>
                setValue(
                  (current) =>
                    normalizeWorktreeBranchPrefix(current) ?? settings.worktreeBranchPrefix,
                )
              }
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
