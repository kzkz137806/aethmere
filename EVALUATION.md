# Public evaluation

Aethmere publishes aggregate results from historical sealed governed-QA evaluations. The public release contains totals, method boundaries and integrity hashes, but not private questions, prompts or model outputs.

## V5 same-question comparison

The Aethmere V5 run and the local 7B no-memory direct-answer baseline used the same sealed questions, languages and denominator.

| Language | Aethmere V5 | 7B no-memory baseline | Pass-rate difference |
|---|---:|---:|---:|
| Chinese | 2,400/2,400 (100.0%) | 1,346/2,400 (56.1%) | +43.9 points |
| English | 2,400/2,400 (100.0%) | 636/2,400 (26.5%) | +73.5 points |
| Combined | 4,800/4,800 (100.0%) | 1,982/4,800 (41.3%) | +58.7 points |

The 7B baseline failed 2,818 cases. Aethmere fixed 2,818/2,818 of those failures and regressed on 0 previously correct cases.

## V3 historical run

| Run | Language | Correct | Missing |
|---|---|---:|---:|
| V3 | Original sealed set | 2,400/2,400 | 0 |

V3 is reported separately because the published same-question 7B comparison belongs to V5.

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
