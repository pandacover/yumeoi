import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	type EntitiesSet,
	evaluateResolution,
	hashEmbeddingsLayer,
	heuristicLlmLayer,
} from "@yumeoi/memory";
import {
	inMemoryObjectStoreLayer,
	inMemoryVectorIndexLayer,
	memoryMemoryRepoLayer,
} from "@yumeoi/test-kit";
import { Effect, Layer } from "effect";

const root = resolve(import.meta.dir, "../../..");
const setPath = resolve(root, "docs/eval/entities-set.json");
const resultsPath = resolve(root, "docs/eval/entities-results.json");
const mdPath = resolve(root, "docs/eval/entities.md");
const stage = process.env.EVAL_STAGE ?? "p4";

const set = JSON.parse(readFileSync(setPath, "utf8")) as EntitiesSet;

const layer = Layer.mergeAll(
	memoryMemoryRepoLayer("resolve-eval"),
	hashEmbeddingsLayer,
	heuristicLlmLayer,
	inMemoryVectorIndexLayer(),
	inMemoryObjectStoreLayer(),
);

const round = (value: number) => Math.round(value * 1000) / 1000;

const run = await Effect.runPromise(evaluateResolution(set).pipe(Effect.provide(layer)));

type StageResult = {
	readonly live: boolean;
	readonly generatedAt: string;
	readonly summary: (typeof run)["summary"];
};

const previous = (() => {
	try {
		return JSON.parse(readFileSync(resultsPath, "utf8")) as Record<string, StageResult>;
	} catch {
		return {} as Record<string, StageResult>;
	}
})();

const snapshot: StageResult = {
	live: false,
	generatedAt: new Date().toISOString(),
	summary: run.summary,
};

const payload = { ...previous, [stage]: snapshot };
writeFileSync(resultsPath, `${JSON.stringify(payload, null, "\t")}\n`);

const current = payload[stage] ?? snapshot;
writeFileSync(
	mdPath,
	`# Entity resolution eval

Mention pairs: \`docs/eval/entities-set.json\` (${set.pairs.length} pairs). Runner: \`bun run eval:entities\`.

Gate: resolution precision ≥ 0.9 (false merges are worse than misses). Persons are never merged on embeddings alone.

| Metric | Value | Gate |
|---|---|---|
| Precision | ${round(current.summary.precision)} | ≥ 0.9 |
| Recall | ${round(current.summary.recall)} | — |
| Accuracy | ${round(current.summary.accuracy)} | — |
| True positives | ${current.summary.truePositives} | |
| False positives | ${current.summary.falsePositives} | |
| False negatives | ${current.summary.falseNegatives} | |
| True negatives | ${current.summary.trueNegatives} | |

Deterministic path uses the heuristic resolver (exact canonical, aliases, conservative person rule). Live LLM confirmation for org/project near-matches is recorded when keys are present.
`,
);

console.log(
	JSON.stringify(
		{ stage, precision: round(run.summary.precision), recall: round(run.summary.recall) },
		null,
		2,
	),
);
