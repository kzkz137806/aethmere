# Aethmere — Governed Context for VS Code 0.12.0

This extension shows and updates project context only through the official `aethmere-agent` command. It requires Aethmere Agent Client 0.12.0 or later and a connected Aethmere account.

## How context commands run

The following are formal context capabilities:

- initialize governed context;
- save the selected editor text;
- show one context item or the current context list;
- refresh the Explorer context view.

Before each command, the extension verifies its installed package manifest is exactly the stable 0.12.0 build. It then uses the shared Aethmere account to obtain the live policy from `https://app.aethmere.com` as `client_kind=vscode`, checks the exact three-client version maps and fixed download URL, flushes its own pending terminal spool, and requires a stored start acknowledgement. A policy requiring a newer VS Code extension stops before prompts, selection or context-ID access, workspace access, or Agent startup.

Inside that extension-governed operation, the extension runs the Agent's exact `--version` response check and rejects versions below 0.12.0, including 0.12.0 prereleases. It then invokes the corresponding Agent command. The Agent independently repeats live governance as `client_kind=agent_client` before it reads or writes context. Both client layers therefore fail closed on their own minimum-version and delivery state.

The extension does not read, write, watch, or open `.aethmere/context.json` itself. The Explorer tree and untitled JSON previews are populated from bounded Agent JSON responses. For a save, the Agent first completes live policy, outbox recovery, and a stored start acknowledgement. Only after the Agent emits the exact bounded `aethmere.stdin-ready.v1` acknowledgement does the extension read the current editor selection. It then sends the complete add request (`id`, `title`, selected `text`, `tags`, and `replace`) as one bounded UTF-8 JSON line to `aethmere-agent add --request-stdin`; none of those values is placed in process arguments or a shell command. Fetching one item uses the same READY-gated stdin protocol with exact `{id}` JSON, so user-defined context IDs are not placed in process arguments either.

Connecting supported clients is a formal capability and is executed directly through the Agent with shell execution disabled and the workspace as its working directory. Setup checks and opening the fixed download page are support operations. They do not read or mutate context.

## Install the required Agent

```bash
npm install -g https://github.com/kzkz137806/aethmere/releases/download/v0.12.0/aethmere-agent-client-0.12.0.tgz
```

Download this extension as `aethmere-vscode-0.12.0.vsix`, then use **Extensions: Install from VSIX...**. Official downloads and supported-version information are at <https://aethmere.com/downloads/>.

After installation:

1. connect the computer to an Aethmere account with the Agent Client;
2. run **Aethmere: Check Agent Client**;
3. run **Aethmere: Initialize Governed Context**;
4. use **Aethmere: Save Selection as Context** or the Explorer view.

## Data boundary

The extension has no configurable server. Its only automatic network destination is `https://app.aethmere.com/api/governance`; it does not send project content there. It reads the shared `~/.aethmere/account.json` authorization, stores only content-free terminal events in its own `~/.aethmere/governance-spool-vscode/`, and must deliver any pending terminal event before another formal capability can start. It starts the locally installed official Agent with shell execution disabled and removes local-server, alternate-account-home, and Node injection overrides from the child environment.

The extension and Agent each send closed governance events to `app.aethmere.com`. Those event bodies contain structured client/step/result metadata, not selected text, context content, prompts, project paths, URLs, account tokens, or secrets. Selected text remains on the local Agent stdin path and in the user-owned project context store.

Versions before 0.12.0 directly accessed the context file and did not enforce this Agent governance chain. They are legacy builds and must not be distributed as governed clients.
