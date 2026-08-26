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

## Native-capability blind run V5 (2026-08-26)

A different operator ran the locked V5 package on an independent physical Apple Silicon Mac. Five exact product versions were exercised against one 18-dimension contract in two fresh-process attempts: 90 cells per attempt and 180 checked cells in total. A stable PASS requires both attempts to pass with equal semantics. N/A is excluded from the applicable-dimension denominator; FAIL and FLAKY are never converted into passes.

| Locked product identity | Stable PASS / applicable | FAIL | FLAKY | N/A |
|---|---:|---:|---:|---:|
| **Aethmere 0.7.0 (`2c1df71712f1b0d006593f7a794ace187bb709f5`)** | **18/18** | **0** | **0** | **0** |
| Graphiti 0.29.3 | 1/16 | 14 | 1 | 2 |
| Letta Code 0.30.29 | 13/17 | 4 | 0 | 1 |
| Mem0 2.0.18 | 12/16 | 3 | 1 | 2 |
| MemOS 2.0.30 | 13/18 | 5 | 0 | 0 |

Aethmere passed all 18 dimensions in both attempts. In this locked matrix it has both the highest stable-pass count and the highest applicable-dimension pass rate. The 14 stable Graphiti failures were locked-timeout outcomes: the native operation did not complete within the fixed time limit. They are not claims that the corresponding feature is absent.

| Result layer | PASS | FAIL | FLAKY | N/A |
|---|---:|---:|---:|---:|
| Attempt 1 | 57 | 28 | — | 5 |
| Attempt 2 | 58 | 27 | — | 5 |
| Cross-attempt stable classification | 57 | 26 | 2 | 5 |

The protocol verifier reported `accepted: true`, `handoff_eligible: true`, and `capability_run_valid: true`. It also reported `capability_all_passed: false` because that field covers the full five-product matrix and the matrix retains non-PASS outcomes; it does not mean Aethmere failed.

| Native-capability artifact | SHA-256 |
|---|---|
| V5 package lock | `34509eb26e47ba6087f4cfd9314a61fe11161c385bccf07f29e45d152723e2ba` |
| Runtime configuration commitment | `038dc726cdb2a9cbab5a977165c35a466fa5b39ca6e4d03327e2623f180f0444` |
| Cross-attempt semantic commitment | `043537e855ba5e098fb8088fe25e8131e8555a6e05f8dbf0c4af9601be71a013` |
| Return receipt | `95ce03255bbe91433daf2216b37e89d5dfa2667cf637ed5548fb5e5a6164d7f1` |
| Return verification | `b8ec979d9fc0866de4c2caac4a64e78bbf7a89a08612d6a9c6e4c3f72b63db0b` |

This is an owner-run, cross-operator and cross-host result, not third-party certification. It applies only to the named versions, fixed contract, synthetic inputs and locked runtime limits. It does not establish open-world superiority, future-version behavior, production reliability, a service-level guarantee or a universal industry ranking. Third-party names and trademarks belong to their respective owners; their appearance does not imply affiliation or endorsement.

## Governed-QA method boundary

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
