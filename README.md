# Aethmere · 识宙

**English** | [简体中文](README.zh-CN.md)

Aethmere is a local-first project-context CLI for Codex and Claude Code. The user-facing command is **`aethmere-agent`**: it saves the context you explicitly choose inside each project and exposes that local material through MCP. The desktop app and VS Code extension are optional interfaces to the same local context. Your project files do not need to be uploaded to Aethmere.

The separate **`aethmere`** command is only an optional public-benchmark verifier. It is not the product CLI and is not required to use Aethmere in a project.

## Install the Aethmere CLI

Node.js 20 or later is required.

```bash
npm install --global https://aethmere.com/downloads/aethmere-agent-0.10.0.tgz
aethmere-agent --version
cd your-project
aethmere-agent init
```

Continue with the [five-minute quick start](QUICKSTART.md) to save project context and connect Codex or Claude Code.

## Product downloads

| Download | Purpose | Install |
|---|---|---|
| **Aethmere CLI 0.10.0 (`aethmere-agent`)** | Save local project context and connect it to Codex or Claude Code through MCP | `npm install -g https://aethmere.com/downloads/aethmere-agent-0.10.0.tgz` |
| **Agent Studio 0.10.1 (Windows x64)** | Optional visual context management and local Ollama chat | Download [`aethmere-agent-studio-0.10.1-win32-x64.zip`](https://github.com/kzkz137806/aethmere/releases/download/v0.10.1/aethmere-agent-studio-0.10.1-win32-x64.zip) |
| **VS Code extension 0.10.0** | Save selected text and inspect local context | Download [`aethmere-vscode-0.10.0.vsix`](https://github.com/kzkz137806/aethmere/releases/download/v0.10.0/aethmere-vscode-0.10.0.vsix) |

Every release file includes a SHA-256 checksum. Studio is an unsigned portable Windows preview: extract the complete ZIP before running `Aethmere Agent Studio.exe`; Windows may display an “Unknown publisher” warning. It does not scan projects, its automatic HTTP access is limited to Ollama on local `127.0.0.1:11434`, and it has no telemetry. Source is available in [`studio/`](studio/), [`agent-client/`](agent-client/), and [`vscode/`](vscode/).

## Windows desktop app (optional)

1. Download the Studio ZIP and `.sha256.txt` from the [v0.10.1 release](https://github.com/kzkz137806/aethmere/releases/tag/v0.10.1).
2. Verify the SHA-256 checksum, then extract the complete archive instead of moving the EXE by itself.
3. Run `Aethmere Agent Studio.exe`, select a project, and save context.
4. To chat with a local model, start Ollama and install at least one model. Context management remains available without Ollama.

Studio and the command-line Agent Client share the same `.aethmere/context.json`, so you can use either or both.

## Connect Codex or Claude Code from the command line

Node.js 20 or later is required. `aethmere-agent` is the Aethmere CLI that users install for project integration.

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

## 18-dimension native measured scorecard (V13)

The composite score now follows the locked V5 evidence directly: `10 × stable PASS ÷ 18`. FAIL, FLAKY, and N/A earn no score credit. The separate applicable-dimension rate still excludes N/A, so coverage and formal pass rate are both visible.

| Rank | Product | V5 native measured score |
|---:|---|---:|
| 1 | **Aethmere** | **10.00 / 10** |
| 2 | Letta Code | 7.22 / 10 |
| 2 | MemOS | 7.22 / 10 |
| 4 | Mem0 | 6.67 / 10 |
| 5 | Graphiti | 0.56 / 10 |

V12 has been withdrawn because it mixed expert-adjudicated documentation baselines with small native-test modifiers; that could leave a product with a worse native result at a higher dimension score. V13 removes those subjective baselines. A score of 10.00 means only 18/18 stable passes in this locked contract—not perfect product quality, third-party certification, a universal ranking, or a production SLA. The complete matrix, formula, hashes, and limitations are in [EVALUATION.md](EVALUATION.md); the machine-readable result is on the [official website](https://aethmere.com/evaluation/peer-scorecard-v13.json).

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

## Optional benchmark verifier

The separately versioned `aethmere` command reproduces public aggregate evaluation data and release-integrity checks. Install it only if you want to audit those published receipts:

```bash
npm install --global https://aethmere.com/downloads/aethmere-cli-0.10.2.tgz
aethmere eval
```

This verifier does not provide project memory or MCP integration. For normal use, install `aethmere-agent` from the product-download table above.

## Public scope

The primary product in this repository is the publicly auditable local Aethmere CLI (`aethmere-agent`), accompanied by the optional Studio and VS Code interfaces. A separate benchmark verifier, aggregate evaluations, and their documentation are included for reproducibility, but they are not the product entry point. Aethmere's private service runtime, internal prompts, retrieval-ranking algorithms, private evaluation items, raw model outputs, customer data, and project materials are not included.

- Website: [aethmere.com](https://aethmere.com)
- Downloads: [GitHub Releases](https://github.com/kzkz137806/aethmere/releases)
- Private security reports: [GitHub private vulnerability reporting](https://github.com/kzkz137806/aethmere/security/advisories/new)

See [LICENSE.txt](LICENSE.txt) for license terms.
