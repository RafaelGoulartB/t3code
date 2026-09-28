# Kiro

T3 Code uses the Kiro CLI installation and login on the connected environment. With a remote
environment, the Kiro setup on the server applies, not the setup on your desktop or phone.

## Install and sign in

Install Kiro CLI by following the [Kiro installation guide](https://kiro.dev/docs/getting-started/installation/), then sign in:

```bash
kiro-cli login
```

For a remote machine without a local browser, use Kiro's device login flow. You can also provide a
`KIRO_API_KEY` through the provider instance environment when your Kiro plan supports API keys.

Kiro is off by default. Open **Settings > Providers**, add or enable Kiro, and refresh the provider
status. T3 Code looks for `kiro-cli` on the environment's `PATH`; set **Binary path** when it is
installed elsewhere.

## Sessions and models

T3 Code communicates with Kiro through its Agent Client Protocol (ACP) mode. Kiro sessions are
saved by the CLI and T3 Code uses their session IDs to continue threads after reconnecting.

The model picker is populated by the installed Kiro CLI. Available models can vary by account,
plan, region, and CLI version. After changing your login or updating Kiro, use **Refresh provider
status** to reload the catalog.

You can optionally configure:

- **KIRO_HOME path** to isolate credentials, configuration, and sessions for an instance.
- **Agent** to start sessions with a named Kiro agent.
- **Agent engine** to select `v1`, `v2`, or `v3`; leave it empty to use the CLI default.

Changing `KIRO_HOME` creates a separate provider identity from the CLI's point of view. Authenticate
that home before starting work.

## Permissions and stopping work

T3 Code maps Kiro's ACP permission requests to its normal permission UI. Full access automatically
chooses an allow option when Kiro offers one; restricted modes keep asking through T3 Code.

Selecting **Stop** sends an ACP session cancellation before T3 Code closes the provider process.
The cancellation applies only to that Kiro thread.

## Remote use

The Kiro process, tools, files, credentials, MCP connections, and session storage all belong to the
machine running the T3 Code server. Web, desktop, and mobile clients can control the same thread
over a local connection, relay, or tunnel without installing Kiro on each client device.
