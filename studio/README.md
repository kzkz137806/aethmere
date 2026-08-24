# Aethmere Agent Studio

Windows x64 public preview. It lets a user choose a project, manage the same `.aethmere/context.json` store used by the public Agent Client, select which entries to send to a local Ollama model, and chat without scanning the project.

The public Studio is intentionally auditable. It contains no private Aethmere service runtime, internal evaluation set, retrieval ranking, private prompt library, customer data, or telemetry. The only automatic HTTP origin is loopback Ollama at `http://127.0.0.1:11434`; official website and GitHub links open only after a user clicks them.

## Development checks

```bash
npm --prefix studio test
```

## Windows package

Set `AETHMERE_ELECTRON_DIST` to a reviewed Windows x64 Electron distribution and run:

```powershell
$env:AETHMERE_ELECTRON_DIST = "C:\path\to\electron\dist"
npm --prefix studio run package:win
```

The build compiles a small public launcher and keeps Electron inside `runtime/`, so ambient Electron logging cannot mutate the extracted package directory. The output is an unsigned portable preview, not an installer. Distribute the complete ZIP with its SHA-256 checksum; never distribute the `.exe` alone.
