# Security policy

Report suspected vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/kzkz137806/aethmere/security/advisories/new).

Do not place passwords, API keys, private memory, personal data, customer data, confidential project material, or exploit details in public issues or pull requests.

The public verification CLI is designed to run `trial` and `check` locally. `doctor --online` only fetches the official release files and checksums; it does not upload project content.

The 0.12.0 Agent Client, Studio, and VS Code extension require device authorization and a live first-party governance connection before formal capabilities run. Account and governance requests use the fixed origin `https://app.aethmere.com`; Studio can additionally contact loopback Ollama at `http://127.0.0.1:11434` when the user requests local-model work. Governance events have a closed result-metadata schema and do not contain prompts, answers, project content, context text, paths, URLs, IP addresses, user-agent strings, account tokens, or secrets. If authorization, policy, minimum version, pending terminal delivery, or the current start acknowledgement cannot be verified, the formal capability stops. Studio does not automatically scan a selected project and reads or writes `.aethmere/context.json` only through governed user actions.

The Windows Studio preview is not code-signed. Verify its published SHA-256, extract the complete ZIP, and run the launcher from that directory. Do not trust a standalone EXE copied from an unknown source.
