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

## 15-dimension target-fit scorecard V12 (2026-08-26)

This scorecard restores the broader comparison that the native-capability table does not replace. It keeps the original 15 dimensions and 100-point weighting, then uses the locked V5 native run only as an evidence adjustment for the ten dimensions it directly samples. The five skill and growth dimensions not exercised by V5 remain grounded in first-party public product documentation reviewed on the stated date.

The result is an **Aethmere balanced-target fit score**, not a universal product-quality constant. It reflects a target that values memory infrastructure (35%), skill systems (26%), verifiable growth (20%) and governance (19%).

| Product | Memory infra | Skill system | Verifiable growth | Governance | Balanced target fit |
|---|---:|---:|---:|---:|---:|
| **Aethmere** | 7.89 | **8.56** | **8.70** | **9.29** | **8.49** |
| MemOS | 8.49 | 6.69 | 8.30 | 7.71 | 7.83 |
| Letta Code | 7.63 | 8.10 | 7.50 | 8.11 | 7.82 |
| Mem0 | **8.70** | 1.25 | 7.40 | 7.68 | 6.31 |
| Graphiti | 8.07 | 1.13 | 5.25 | 7.53 | 5.60 |

### Complete 15-dimension matrix

Scores use a 0–10 scale in 0.5 increments. Bold marks the highest score in a row; ties are retained.

| Dimension | Weight | Aethmere | Letta Code | MemOS | Mem0 | Graphiti |
|---|---:|---:|---:|---:|---:|---:|
| Long-term memory objects / storage | 7 | 8.0 | 8.0 | **9.5** | 8.5 | 8.5 |
| Retrieval / hybrid / graph quality | 8 | 8.0 | 6.5 | 8.0 | **9.0** | 8.5 |
| Temporal, conflict and provenance | 7 | 8.5 | 7.5 | 7.0 | **9.0** | 8.5 |
| Scale, deployment and latency | 7 | 6.5 | 7.5 | **9.5** | 8.0 | 8.5 |
| Edit, forget and feedback | 6 | 8.5 | **9.0** | 8.5 | **9.0** | 6.0 |
| Skills as first-class / portable objects | 7 | **9.0** | **9.0** | 8.0 | 1.5 | 1.5 |
| Discovery, triggering and progressive loading | 5 | **8.5** | **8.5** | 7.0 | 1.0 | 1.0 |
| Execution runtime, permissions and sandbox | 6 | 7.5 | **9.5** | 6.5 | 1.5 | 1.0 |
| Skill validation and lifecycle | 8 | **9.0** | 6.0 | 5.5 | 1.0 | 1.0 |
| Problem-to-growth loop | 8 | **9.0** | **9.0** | 8.0 | 6.5 | 4.5 |
| Feedback-to-improvement | 6 | 8.0 | **8.5** | 8.0 | 7.5 | 4.0 |
| Durability, rerun and exam evidence | 6 | **9.0** | 4.5 | **9.0** | 8.5 | 7.5 |
| Source of truth, audit and migration | 6 | **9.5** | 9.0 | 7.5 | 8.5 | 8.0 |
| Multi-agent / concurrency governance | 5 | **9.5** | 8.0 | 7.5 | 7.0 | 7.0 |
| Correctness gates, safety and operations | 8 | **9.0** | 7.5 | 8.0 | 7.5 | 7.5 |

### Weight sensitivity

| Profile | Memory infra | Skill | Growth | Governance | Leader | Aethmere |
|---|---:|---:|---:|---:|---|---:|
| Balanced target | 35 | 26 | 20 | 19 | **Aethmere 8.49** | 1/5 · 8.49 |
| Memory-first | 80 | 5 | 5 | 10 | **MemOS 8.31** | 3/5 · 8.10 |
| Skill-growth | 15 | 35 | 35 | 15 | **Aethmere 8.62** | 1/5 · 8.62 |
| Governance-first | 20 | 20 | 20 | 40 | **Aethmere 8.74** | 1/5 · 8.74 |

This sensitivity check is material: Aethmere leads under the balanced, skill-growth and governance profiles, but it is third under a memory-infrastructure-first objective. MemOS and Mem0 remain stronger choices when memory infrastructure dominates the objective.

### Method and evidence boundary

- The documented baseline is an expert-adjudicated score based only on first-party public product sources. It is not a benchmark measurement.
- For the ten directly sampled dimensions, the native evidence ratio is `(stable PASS + 0.5 × FLAKY) / applicable cells`; N/A is excluded. Ratios of at least 90%, 70%, 40% and below 40% apply modifiers of `+0.5`, `0`, `-0.5` and `-1.0`, respectively. Final dimension scores are capped at 9.5.
- A locked-run timeout can lower verified operability under that limit, but is never treated as proof that a documented feature is absent. This is especially important for Graphiti's V5 result.
- No product receives 10 because this review does not establish multi-domain, multi-scale, independently reproduced superiority.
- The machine-readable weights, documented baselines, native evidence counts and formula are published at [aethmere.com/evaluation/peer-scorecard-v12.json](https://aethmere.com/evaluation/peer-scorecard-v12.json).

First-party product sources reviewed for the documented layer: [Aethmere](https://github.com/kzkz137806/aethmere), [Letta Code](https://github.com/letta-ai/letta-code), [Letta MemFS](https://github.com/letta-ai/letta-docs-md/blob/main/concepts/memfs/index.md), [MemOS](https://github.com/MemTensor/MemOS), [Mem0](https://github.com/mem0ai/mem0), [Mem0 Graph Memory](https://docs.mem0.ai/open-source/features/graph-memory), [Mem0 REST API](https://docs.mem0.ai/open-source/features/rest-api), and [Graphiti](https://github.com/getzep/graphiti).

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
