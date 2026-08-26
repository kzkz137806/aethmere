# Aethmere · 识宙

**English** | [简体中文](README.zh-CN.md)

Aethmere helps local models, Codex, and Claude Code continue from the project context you explicitly save. The desktop app manages context and can chat through local Ollama models; the CLI and editor extension connect the same local material to your development tools. Your project files do not need to be uploaded to Aethmere.

## Downloads

| Download | Purpose | Install |
|---|---|---|
| **Agent Studio 0.10.1 (Windows x64)** | Visual context management and local Ollama chat | Download [`aethmere-agent-studio-0.10.1-win32-x64.zip`](https://github.com/kzkz137806/aethmere/releases/download/v0.10.1/aethmere-agent-studio-0.10.1-win32-x64.zip) |
| **Agent Client 0.10.0** | Local context and MCP integration | `npm install -g https://aethmere.com/downloads/aethmere-agent-0.10.0.tgz` |
| **VS Code extension 0.10.0** | Save selected text and inspect local context | Download [`aethmere-vscode-0.10.0.vsix`](https://github.com/kzkz137806/aethmere/releases/download/v0.10.0/aethmere-vscode-0.10.0.vsix) |
| **Evaluation CLI 0.10.2** | Inspect V3/V5 comparisons between an Aethmere-supported 7B model and the same 7B model without memory | `npm install -g https://aethmere.com/downloads/aethmere-cli-0.10.2.tgz` |

Every release file includes a SHA-256 checksum. Studio is an unsigned portable Windows preview: extract the complete ZIP before running `Aethmere Agent Studio.exe`; Windows may display an “Unknown publisher” warning. It does not scan projects, its automatic HTTP access is limited to Ollama on local `127.0.0.1:11434`, and it has no telemetry. Source is available in [`studio/`](studio/), [`agent-client/`](agent-client/), and [`vscode/`](vscode/).

## Windows desktop app

1. Download the Studio ZIP and `.sha256.txt` from the [v0.10.1 release](https://github.com/kzkz137806/aethmere/releases/tag/v0.10.1).
2. Verify the SHA-256 checksum, then extract the complete archive instead of moving the EXE by itself.
3. Run `Aethmere Agent Studio.exe`, select a project, and save context.
4. To chat with a local model, start Ollama and install at least one model. Context management remains available without Ollama.

Studio and the command-line Agent Client share the same `.aethmere/context.json`, so you can use either or both.

## Connect Codex or Claude Code from the command line

Node.js 20 or later is required. `aethmere-agent` is the agent integration client; `aethmere` is the evaluation and verification tool.

```bash
node --version
npm install --global https://aethmere.com/downloads/aethmere-agent-0.10.0.tgz
aethmere-agent --version
cd your-project
aethmere-agent init
aethmere-agent add --id PROJECT_GOAL --title "Project goal" --text "Add the background you want your AI to retain"
aethmere-agent list
aethmere-agent doctor
aethmere-agent connect --client all --check
aethmere-agent connect --client all
```

After restarting Codex or Claude Code, the agent can list and read the current project's local context through MCP. See [QUICKSTART.md](QUICKSTART.md) for the complete guide.

## Sealed same-question evaluation

V5 contains 4,800 Chinese and English test items in total:

| System | Correct | Accuracy |
|---|---:|---:|
| 7B model with Aethmere support (V5) | 4,800/4,800 | 100.0% |
| The same 7B model without memory, answering directly | 1,982/4,800 | 41.3% |

Both groups use the same 7B model, sealed items, languages, and denominator; the difference is whether Aethmere support and memory are used. The no-memory baseline scores 1,346/2,400 (56.1%) in Chinese and 636/2,400 (26.5%) in English. The Aethmere-supported model repairs all 2,818/2,818 baseline failures with zero regressions on the items the baseline originally answered correctly. Evaluation design, V3 results, and limitations are documented in [EVALUATION.md](EVALUATION.md).

## Independent-device blind test across 18 native capabilities (V5)

On 2026-08-26, a different operator tested five locked product versions on an independent physical Apple Silicon Mac under one 18-dimension contract. Two runs produced 180 checked cells in total; all FAIL, FLAKY, and N/A outcomes are retained. A stable PASS requires the same cell to pass with matching semantics in both runs.

| Locked product version | Stable PASS / applicable dimensions | FAIL | FLAKY | N/A |
|---|---:|---:|---:|---:|
| **Aethmere 0.7.0 (`2c1df71`)** | **18/18** | **0** | **0** | **0** |
| Graphiti 0.29.3 | 1/16 | 14 | 1 | 2 |
| Letta Code 0.30.29 | 13/17 | 4 | 0 | 1 |
| Mem0 2.0.18 | 12/16 | 3 | 1 | 2 |
| MemOS 2.0.30 | 13/18 | 5 | 0 | 0 |

Aethmere scores 18/18 in both runs and has the highest stable-pass count and applicable-dimension pass rate in this locked matrix. Graphiti's 14 stable FAIL outcomes mean that its native operations did not complete within the locked time limit; they do not establish that the functions can never be performed. Protocol verification passes, while the five-product matrix still contains non-PASS cells, so the aggregate `capability_all_passed` value is correctly `false`; this does not mean that Aethmere failed. Counts, integrity hashes, method, and limits on generalization are available in [EVALUATION.md](EVALUATION.md).

## Public scope

This repository contains the publicly auditable local Studio, Agent Client, VS Code extension, verification CLI, aggregate evaluations, and usage documentation. Aethmere's private service runtime, internal prompts, retrieval-ranking algorithms, private evaluation items, raw model outputs, customer data, and project materials are not included.

- Website: [aethmere.com](https://aethmere.com)
- Downloads: [GitHub Releases](https://github.com/kzkz137806/aethmere/releases)
- Private security reports: [GitHub private vulnerability reporting](https://github.com/kzkz137806/aethmere/security/advisories/new)

See [LICENSE.txt](LICENSE.txt) for license terms.
