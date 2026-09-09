# Recall eval

Labeled retrieval set: `docs/eval/recall-set.json` (40 dated documents, 80 queries). Matchers are `{ contains, kind?, type? }` because memory ids are not stable across runs. `asOf` / `from` / `to` / `graph` tags are present for later phases; P0 scores packed memories against matchers only.

Harness: `scoreRecall` in `packages/memory/src/eval.ts`, runner `apps/app/scripts/eval-recall.ts` (`bun run eval:recall`). Deterministic path uses hash embeddings, in-memory Vectorize, and the heuristic extractor so CI can fail fusion/filter/pack regressions without keys.

Live extraction uses OpenRouter (OpenAI fallback) when `EVAL_LIVE=1` and `OPENROUTER_API_KEY` / `OPENAI_API_KEY` are set. Embeddings stay hash in this bun runner; workerd tests cover the Vectorize emulator.

Raw numbers: `docs/eval/recall-results.json`. Set `EVAL_STAGE=baseline` or `EVAL_STAGE=after-fixes` when recording a phase.

## Deterministic numbers

| Stage | Recall@5 | Recall@10 | MRR | nDCG@10 | Context P | Tokens/recall | p50 ms | Extract |
|---|---|---|---|---|---|---|---|---|
| baseline (before P0 fixes) | 0.35 | 0.55 | 0.221 | 0.333 | 0.036 | 743 | 1 | heuristic |

P0 records a baseline **before** retrieval changes, then the same table after D1–D5 / D3 / D7. Later phases must not regress Recall@10 or nDCG@10.
