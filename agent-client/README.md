# Aethmere Agent Client (0.12.0)

This is the public, auditable CLI and MCP connector for user-owned project context.

## Required connection

Version 0.12.0 is a governed online client. Before any formal context capability runs, it must:

1. authenticate a device authorization with https://app.aethmere.com;
2. fetch the current governance policy and supported-version floor;
3. receive an acknowledgement for a closed started event;
4. send a terminal result event after the local capability finishes.

If a terminal event cannot be delivered, it is kept in a private local outbox. The next formal capability is blocked until that outbox is acknowledged. Logging out removes the device authorization but does not erase pending terminal events. Each local outbox entry is bound to the SHA-256 hash of the service-provided stable account ID: signing back into the same account can resume delivery, while a different account fails closed instead of receiving another account's event. The raw account ID is not stored in the account file or outbox. Missing accounts, network failures, policy mismatches and unsupported versions fail closed before project context is read or changed.

The event body contains only the documented closed fields: client/version/platform family, capability step, result/reason code, coarse duration/attempt/day buckets and random flow IDs. It does not contain prompts, context text, answers, project files, paths, URLs, IP fields, User-Agent fields, account tokens or secrets. Normal network infrastructure can still observe connection metadata; this statement describes the governance event body and stored event schema.

Login, logout, connection diagnosis, update checks and explicit user-data deletion remain available as recovery/support actions.

## Install

Node.js 20 or newer is required.

    npm install -g https://aethmere.com/downloads/aethmere-agent-client-0.12.0.tgz
    aethmere-agent --version

In the Aethmere web app, generate a one-time computer connection code, then run:

    aethmere-agent login --code YOUR_CODE
    aethmere-agent doctor

The normal login success message is:

    Aethmere account connected. Live governance will be verified before every formal capability.

## Use

    cd your-project
    aethmere-agent init
    aethmere-agent add --id PROJECT_GOAL --title "Project goal" --text "The durable project goal"
    printf "Private editor selection" | aethmere-agent add --id SELECTION --title "Selection" --stdin
    aethmere-agent list
    aethmere-agent connect --client all --check
    aethmere-agent connect --client all

Project context remains in .aethmere/context.json. Context content is not placed in governance event bodies.

## Legacy versions

Versions 0.10.x and 0.11.x were local-only previews. They do not implement the required governance chain and are unsupported for formal Aethmere use. Existing copies cannot be remotely converted; replace them with 0.12.0 or later.

Check the service version floor at any time:

    aethmere-agent update-check

## Uninstall and delete

    npm uninstall -g aethmere-agent

Uninstalling does not delete project context. To delete an item explicitly:

    aethmere-agent remove --id ITEM_ID --yes
