import { useEffect, useState } from "react";
import { DEFAULT_WORKTREE_BRANCH_PREFIX, normalizeWorktreeBranchPrefix } from "@t3tools/shared/git";
import { DEFAULT_PULL_REQUEST_SYSTEM_PROMPT } from "@t3tools/contracts";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
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
  const [pullRequestSystemPrompt, setPullRequestSystemPrompt] = useState(
    settings.pullRequestSystemPrompt,
  );
  const normalized = normalizeWorktreeBranchPrefix(value);
  const invalid = value.trim().length > 0 && normalized === null;

  useEffect(() => {
    setValue(settings.worktreeBranchPrefix);
  }, [settings.worktreeBranchPrefix]);

  useEffect(() => {
    setPullRequestSystemPrompt(settings.pullRequestSystemPrompt);
  }, [settings.pullRequestSystemPrompt]);

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
        <SettingsRow
          title="Pull request system prompt"
          description="Instructions used to generate pull request titles and descriptions. Git context and the required structured response are added by the app."
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={pullRequestSystemPrompt === DEFAULT_PULL_REQUEST_SYSTEM_PROMPT}
              onClick={() => {
                setPullRequestSystemPrompt(DEFAULT_PULL_REQUEST_SYSTEM_PROMPT);
                updateSettings({ pullRequestSystemPrompt: DEFAULT_PULL_REQUEST_SYSTEM_PROMPT });
              }}
            >
              Restore default prompt
            </Button>
          }
        >
          <div className="pb-3.5">
            <Textarea
              aria-label="Pull request system prompt"
              className="min-h-48 resize-y"
              value={pullRequestSystemPrompt}
              onChange={(event) => setPullRequestSystemPrompt(event.target.value)}
              onBlur={() => updateSettings({ pullRequestSystemPrompt })}
            />
          </div>
        </SettingsRow>
        <SettingsRow
          title="Include text generation convention"
          description="Include the Text generation convention's Additional instructions when generating pull request content."
          resetAction={
            !settings.includeTextGenerationConventionInPullRequestPrompt ? (
              <SettingResetButton
                label="pull request text generation convention"
                onClick={() =>
                  updateSettings({ includeTextGenerationConventionInPullRequestPrompt: true })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.includeTextGenerationConventionInPullRequestPrompt}
              onCheckedChange={(checked) =>
                updateSettings({
                  includeTextGenerationConventionInPullRequestPrompt: Boolean(checked),
                })
              }
              aria-label="Include text generation convention in pull request prompt"
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
