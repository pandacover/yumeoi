# Types eval

Labeled classification set: `docs/eval/types-set.json` (80 statements, balanced semantic / episodic / procedural, including decisions, recurring tasks, and preference-as-rule cases). Scorer: `scoreClassification` in `packages/memory/src/eval.ts`. Runner: `apps/app/scripts/eval-types.ts` (`bun run eval:types`).

The deterministic path uses `heuristicLlmLayer` so CI can fail a collapsed classifier without keys. Live classification uses OpenRouter (OpenAI fallback) when `EVAL_LIVE=1` and keys are set. P1 gate is live accuracy ≥ 0.85.

Raw numbers: `docs/eval/types-results.json`. Set `EVAL_STAGE=heuristic` or `EVAL_STAGE=live` when recording a phase.

## Numbers

| Stage | Live | Accuracy | Cases | Model | Effort |
|---|---|---:|---:|---|---|
| heuristic | no | 0.975 | 80 | gpt-5.6-luna | none |

Current stage `heuristic` accuracy **0.975**.

## Confusion (heuristic)

| expected \ predicted | semantic | episodic | procedural |
|---|---|---|---|
| semantic | 27 | 0 | 0 |
| episodic | 2 | 25 | 0 |
| procedural | 0 | 0 | 26 |

Classify job pin: Luna `none` (`defaultLlmConfig.classify`). Re-run with `EVAL_LIVE=1` before changing the pin.
