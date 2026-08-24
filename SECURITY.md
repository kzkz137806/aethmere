# Security policy

Report suspected vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/kzkz137806/aethmere/security/advisories/new).

Do not place passwords, API keys, private memory, personal data, customer data, confidential project material, or exploit details in public issues or pull requests.

The public verification CLI is designed to run `trial` and `check` locally. `doctor --online` only fetches the official release files and checksums; it does not upload project content.

The public Agent Studio does not scan a selected project. It reads and writes only `.aethmere/context.json` after explicit user actions. Its only automatic HTTP origin is loopback Ollama at `http://127.0.0.1:11434`; opening the official website or GitHub Releases requires a user click. No telemetry is bundled.

The Windows Studio preview is not code-signed. Verify its published SHA-256, extract the complete ZIP, and run the launcher from that directory. Do not trust a standalone EXE copied from an unknown source.
