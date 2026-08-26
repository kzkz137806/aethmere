# Changelog

## Unreleased — 2026-08-26

- Restored the user-facing `aethmere-agent` CLI as the GitHub product entry point and moved the separately versioned `aethmere` benchmark verifier out of the primary download path.
- Replaced the V12 hybrid documentation/native scorecard with the evidence-first V13 score: `10 × stable PASS ÷ 18`.
- Published the complete D01–D18 two-run matrix, shared ranks, applicable-dimension counts, and explicit owner-run/non-SLA boundaries.
- Withdrew the subjective documentation baselines and weight profiles because they could rank a lower native result above a higher one; no client artifact or historical V3/V5 result changed.

## 0.10.2 — 2026-08-25

- Corrected every public V5 comparison label to name the same 7B model with Aethmere versus without memory.
- Kept all V3/V5 counts, denominators and source-receipt hashes unchanged.
- Released only the verification CLI and aggregate wording update; Agent Client, VS Code and Agent Studio artifacts remain unchanged.

## 0.10.1 — 2026-08-24

- Added an auditable Windows x64 Agent Studio public preview for managing `.aethmere/context.json` and chatting through a loopback Ollama model.
- Added a small native launcher that keeps the extracted portable directory unchanged after startup; verified a fresh extracted ZIP before and after launch against 84 artifact hashes.
- Kept the private service runtime, retrieval/ranking implementation, internal prompts, private evaluations and project material out of the desktop package.
- Published the Studio as an unsigned portable ZIP with an explicit unknown-publisher notice and SHA-256 checksum; no installer or code-signing claim is made.

## 0.10.0 — 2026-08-24

- Added a zero-dependency local Agent Client with real MCP handshake, local context management and Codex/Claude Code connection commands.
- Added a minimal VS Code plugin for saving selected text to the local context store and connecting the current workspace.
- Published the full same-question V5 comparison between a 7B model with Aethmere and the same 7B model without memory: Chinese, English and combined correct/total counts and rates.
- Kept private service runtime, recall/ranking implementation, internal workflows, prompts, cases and raw outputs outside public artifacts.

## 0.9.0 — 2026-08-24

- Published the reviewed V3/V5 sealed evaluation aggregate and method boundary.
- Added `aethmere eval` plus online hash checks for the website and GitHub copies.
- Kept raw questions, prompts, model outputs and private runtime source outside the public release.

## 0.8.1 — 2026-08-24

- Published the zero-dependency local verification CLI.
- Added strict evidence-ID positive and adversarial examples, a checker for user-supplied JSON, and release-integrity checks.
- Kept private runtime source, private cases, prompts, raw outputs, customer data, and project material outside the public repository and package.
