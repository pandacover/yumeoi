# Entity resolution eval

Mention pairs: `docs/eval/entities-set.json` (60 pairs). Runner: `bun run eval:entities`.

Gate: resolution precision ≥ 0.9 (false merges are worse than misses). Persons are never merged on embeddings alone.

| Metric | Value | Gate |
|---|---|---|
| Precision | 1 | ≥ 0.9 |
| Recall | 1 | — |
| Accuracy | 1 | — |
| True positives | 30 | |
| False positives | 0 | |
| False negatives | 0 | |
| True negatives | 30 | |

Deterministic path uses the heuristic resolver (exact canonical, aliases, conservative person rule). Live LLM confirmation for org/project near-matches is recorded when keys are present.
