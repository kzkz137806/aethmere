# Public evaluation

Aethmere publishes aggregate results from historical sealed governed-QA evaluations. The public release contains totals, method boundaries and integrity hashes, but not private questions, prompts or model outputs.

## V5 same-model, same-question comparison

Both sides used the same local 7B model, sealed questions, languages and denominator. The evaluated V5 side used the 7B model with Aethmere; the baseline used the same 7B model without memory and answered directly.

| Language | 7B model with Aethmere (V5) | Same 7B model without memory | Pass-rate difference |
|---|---:|---:|---:|
| Chinese | 2,400/2,400 (100.0%) | 1,346/2,400 (56.1%) | +43.9 points |
| English | 2,400/2,400 (100.0%) | 636/2,400 (26.5%) | +73.5 points |
| Combined | 4,800/4,800 (100.0%) | 1,982/4,800 (41.3%) | +58.7 points |

The same-7B no-memory baseline failed 2,818 cases. The 7B model with Aethmere fixed 2,818/2,818 of those failures and regressed on 0 previously correct cases.

## V3 historical run

| Run | Language | Correct | Missing |
|---|---|---:|---:|
| V3 | Original sealed set | 2,400/2,400 | 0 |

V3 is reported separately because the published same-model, with/without-Aethmere comparison belongs to V5.

## Peer engineering evidence audit (2026-08-25)

Each product was installed in an isolated environment and checked against frozen contracts. The score below measures evidence maturity against Aethmere's 18-dimension target profile; it is **not an overall product score or industry ranking**. Product surfaces are not fully isomorphic, so an unsupported or non-comparable cell is not silently converted into a failure.

| Evaluated product snapshot | Target-profile evidence maturity (max 100) |
|---|---:|
| Aethmere (2026-08-25 source snapshot) | 68.75 |
| Graphiti 0.29.3 | 41.50 |
| Letta Code 0.30.29 | 21.00 |
| Mem0 2.0.18 | 36.50 |
| MemOS 2.0.31 | 39.75 |

Evidence qualification status: Aethmere project evidence **17/18**; peer-isolated evidence **6/18**; independent reproduction evidence **0/18**; industry-leading evidence **0/18**.

The following slices had sufficiently aligned contracts for a direct engineering comparison:

| Frozen slice | Aethmere | Graphiti 0.29.3 | Letta Code 0.30.29 | Mem0 2.0.18 | MemOS 2.0.31 |
|---|---:|---:|---:|---:|---:|
| Lifecycle contracts | 6/6 | 5/6 | 3/6* | 5/6 | 4/6 |
| Frozen retrieval semantics (10 cases) | 10/10 | 10/10 | N/A | 9/10 | 10/10 |
| Capacity at 1/8/32 (150 checks) | 150/150 | 150/150 | N/A | 147/150 | 150/150 |
| Strict soak | 7,500/7,500; passed | offer-timing gate failed | N/A | 5,771 late timeouts | offer-timing gate failed |

\* The Letta Code lifecycle result includes unsupported cells. Graphiti's two tested backends count as one product. Slice counts are not additive. These results describe the named versions, selected surfaces and test snapshot only; they do not establish overall product quality, market position or future-version performance. Third-party names and trademarks belong to their respective owners, and their appearance here does not imply affiliation or endorsement.

## Method boundary

- Eight fixed task slices with 300 cases per slice and language.
- Generation-time deterministic exact-string answers; no open-ended judge was used.
- The seed was revealed only after the evaluated snapshot had been frozen.
- Missing results, failures, timeouts and answerable abstentions remain in the denominator.
- The V5 reducer was not amended after freeze, and its recorded question-surface mismatch count is zero.

The machine-readable aggregate is [evaluation/governed-qa-v3-v5.json](evaluation/governed-qa-v3-v5.json). Run `aethmere eval` to inspect the copy bundled with the verification CLI, or `aethmere doctor --online` to compare the official website and GitHub release hashes.

## What these results do not claim

This historical sealed evaluation does not bind the current product runtime, public Agent Client or VS Code plugin and does not measure open-world questions, live-model behavior, production accuracy or universal accuracy. It is evidence for the named restricted task only; historical sealed evidence does not measure open-world performance.

## Integrity hashes

| Artifact | SHA-256 |
|---|---|
| V3 freeze manifest | `a06b572aa022169dea3cc81845a7969f53ae9c6be3dea3e1ddf6a1de43585fad` |
| V3 main reduction | `83d1f1adb92ee4bb30290b7230a116c70f5b16e8afbd09fc5d6d701a89954741` |
| V5 freeze manifest | `8f19ef4fa29e8210e3e905338980c1d2c68f65af05428e6dc5878307ff2e95b0` |
| V5 Chinese main reduction | `d0a0828c80e8ae756118fd01821c00ab8bb9c8b4b9579d18430014ba3667a44c` |
| V5 English main reduction | `10c13d43e5769a118b9762d5a3fc67fb7f33e56cb68026ab20c27928819f3d59` |
| V5 Chinese cure reduction | `479ceedddf833c22402fc587fc21c78e57c4d12f6daf3feb87dc2d96ea51d36c` |
| V5 English cure reduction | `620c265a67a19df441ee3cae2d48a0b8a3f069a39abe79539d5699a86f7becb7` |
