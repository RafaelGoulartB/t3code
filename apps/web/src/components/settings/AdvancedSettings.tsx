import { useEffect, useState } from "react";
import { DEFAULT_PULL_REQUEST_SYSTEM_PROMPT, type EnvironmentId } from "@t3tools/contracts";
import { DEFAULT_WORKTREE_BRANCH_PREFIX, normalizeWorktreeBranchPrefix } from "@t3tools/shared/git";

import {
  useEnvironmentSettings,
  usePrimarySettings,
  useUpdateEnvironmentSettings,
  useUpdatePrimarySettings,
} from "../../hooks/useSettings";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { jiraEnvironment } from "../../state/jira";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
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

  useEffect(() => setValue(settings.worktreeBranchPrefix), [settings.worktreeBranchPrefix]);
  useEffect(
    () => setPullRequestSystemPrompt(settings.pullRequestSystemPrompt),
    [settings.pullRequestSystemPrompt],
  );

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
                if (validPrefix) updateSettings({ worktreeBranchPrefix: validPrefix });
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
      <JiraIntegrationSettings />
    </SettingsPageContainer>
  );
}

const JIRA_STATUS_LABEL = {
  disabled: "Disabled",
  cli_missing: "ACLI not found",
  unauthenticated: "Not signed in",
  authenticated: "Connected",
  error: "Connection check failed",
} as const;

function JiraIntegrationSettings() {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const [environmentId, setEnvironmentId] = useState<EnvironmentId | null>(primaryEnvironmentId);

  useEffect(() => {
    if (
      !environmentId ||
      !environments.some((environment) => environment.environmentId === environmentId)
    ) {
      setEnvironmentId(primaryEnvironmentId ?? environments[0]?.environmentId ?? null);
    }
  }, [environmentId, environments, primaryEnvironmentId]);

  return (
    <SettingsSection title="Jira integration">
      {environmentId ? (
        <JiraIntegrationSettingsForEnvironment
          environmentId={environmentId}
          onEnvironmentChange={setEnvironmentId}
        />
      ) : (
        <p className="px-4 pb-4 text-sm text-muted-foreground">
          Connect a server to configure Jira integration.
        </p>
      )}
    </SettingsSection>
  );
}

function JiraIntegrationSettingsForEnvironment({
  environmentId,
  onEnvironmentChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly onEnvironmentChange: (environmentId: EnvironmentId) => void;
}) {
  const { environments } = useEnvironments();
  const settings = useEnvironmentSettings(environmentId);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const jiraStatus = useEnvironmentQuery(jiraEnvironment.status({ environmentId, input: {} }));
  const jiraLogin = useAtomCommand(jiraEnvironment.login, { reportFailure: false });
  const jiraLogout = useAtomCommand(jiraEnvironment.logout, { reportFailure: false });
  const jiraSwitch = useAtomCommand(jiraEnvironment.switchAccount, { reportFailure: false });
  const status = jiraStatus.data;
  const refreshAfter = (run: Promise<unknown>) => void run.finally(jiraStatus.refresh);

  return (
    <>
      <SettingsRow
        title="Server environment"
        description="Jira and Atlassian CLI authentication are configured on the selected server."
        control={
          <select
            aria-label="Jira server environment"
            className="h-8 max-w-64 rounded-md border border-input bg-background px-2 text-xs"
            value={environmentId}
            onChange={(event) => onEnvironmentChange(event.target.value as EnvironmentId)}
          >
            {environments.map((environment) => (
              <option key={environment.environmentId} value={environment.environmentId}>
                {environment.label}
              </option>
            ))}
          </select>
        }
      />
      <SettingsRow
        title="Enable Jira integration"
        description="Show Jira when this server has Atlassian CLI installed and signed in."
        status={JIRA_STATUS_LABEL[status?.state ?? (settings.jira.enabled ? "error" : "disabled")]}
        control={
          <Switch
            checked={settings.jira.enabled}
            onCheckedChange={(checked) =>
              updateSettings({ jira: { ...settings.jira, enabled: Boolean(checked) } })
            }
            aria-label="Enable Jira integration"
          />
        }
      />
      <SettingsRow
        title="ACLI binary path"
        description="Use acli when it is on PATH; otherwise provide the executable path, for example C:\\Tools\\acli.exe. Do not include command arguments."
        control={
          <Input
            className="sm:w-64"
            aria-label="Atlassian CLI binary path"
            value={settings.jira.binaryPath}
            onValueChange={(binaryPath) =>
              updateSettings({ jira: { ...settings.jira, binaryPath } })
            }
          />
        }
      />
      {settings.jira.enabled ? (
        <SettingsRow
          title="Jira account"
          description={
            status?.state === "authenticated"
              ? "Connected through Atlassian CLI."
              : "Browser login must be completed on this server host."
          }
          status={status?.message}
          control={
            <div className="flex flex-wrap gap-2">
              <Button size="xs" variant="outline" onClick={jiraStatus.refresh}>
                Refresh status
              </Button>
              {status?.state === "authenticated" ? (
                <>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      const site = window.prompt("Jira site (optional)", "")?.trim();
                      const email = window.prompt("Jira account email (optional)", "")?.trim();
                      if (site || email)
                        refreshAfter(
                          jiraSwitch({
                            environmentId,
                            input: { ...(site ? { site } : {}), ...(email ? { email } : {}) },
                          }),
                        );
                    }}
                  >
                    Switch account
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      if (window.confirm("Sign out of Jira on this server?"))
                        refreshAfter(jiraLogout({ environmentId, input: {} }));
                    }}
                  >
                    Sign out
                  </Button>
                </>
              ) : status?.state !== "cli_missing" ? (
                <Button
                  size="xs"
                  onClick={() => refreshAfter(jiraLogin({ environmentId, input: {} }))}
                >
                  Sign in with browser
                </Button>
              ) : null}
            </div>
          }
        />
      ) : null}
      {settings.jira.enabled && status?.state === "cli_missing" ? (
        <p className="px-4 pb-4 text-xs text-muted-foreground">
          Install Atlassian CLI on this server, then refresh status.{" "}
          <a
            className="underline"
            href="https://developer.atlassian.com/cloud/acli/guides/install-acli/"
            target="_blank"
            rel="noreferrer"
          >
            Installation help
          </a>
        </p>
      ) : null}
    </>
  );
}
