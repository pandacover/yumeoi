import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gatewayLlmLayer, resolveGatewayLlmProviders } from "@yumeoi/cf-runtime/llm-openai";
import { defaultLlmConfig } from "@yumeoi/domain";
import {
	consolidatorLayer,
	evaluateRecall,
	extractorLayer,
	hashEmbeddingsLayer,
	heuristicLlmLayer,
	type RecallSet,
} from "@yumeoi/memory";
import {
	inMemoryObjectStoreLayer,
	inMemoryVectorIndexLayer,
	memoryMemoryRepoLayer,
} from "@yumeoi/test-kit";
import { Effect, Layer } from "effect";

const root = resolve(import.meta.dir, "../../..");
const setPath = resolve(root, "docs/eval/recall-set.json");
const resultsPath = resolve(root, "docs/eval/recall-results.json");
const mdPath = resolve(root, "docs/eval/recall.md");
const stage = process.env.EVAL_STAGE ?? "current";

const set = JSON.parse(readFileSync(setPath, "utf8")) as RecallSet;

const openrouterApiKey = process.env.OPENROUTER_API_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY;
const providers = resolveGatewayLlmProviders({
	openrouter: {
		apiKey: openrouterApiKey,
		baseURL: openrouterApiKey
			? (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1")
			: undefined,
	},
	openai: {
		apiKey: openaiApiKey,
		baseURL: openaiApiKey
			? (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1")
			: undefined,
	},
});
const live = providers.length > 0 && process.env.EVAL_LIVE === "1";
const llm = live ? gatewayLlmLayer({ config: defaultLlmConfig, providers }) : heuristicLlmLayer;

const layer = Layer.mergeAll(
	memoryMemoryRepoLayer("recall-eval"),
	hashEmbeddingsLayer,
	llm,
	Layer.provide(extractorLayer, llm),
	Layer.provide(consolidatorLayer, llm),
	inMemoryVectorIndexLayer(),
	inMemoryObjectStoreLayer(),
);

const round = (value: number) => Math.round(value * 1000) / 1000;

const run = await Effect.runPromise(evaluateRecall(set).pipe(Effect.provide(layer)));

type StageResult = {
	readonly live: boolean;
	readonly generatedAt: string;
	readonly embeddings: string;
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
	live,
	generatedAt: new Date().toISOString(),
	embeddings: "hash",
	summary: run.summary,
};

const payload = { ...previous, [stage]: snapshot };
writeFileSync(resultsPath, `${JSON.stringify(payload, null, 2)}\n`);

const row = (name: string, item?: StageResult) =>
	item
		? [
				name,
				String(round(item.summary.recallAt5)),
				String(round(item.summary.recallAt10)),
				String(round(item.summary.mrr)),
				String(round(item.summary.ndcgAt10)),
				String(round(item.summary.contextPrecision)),
				String(Math.round(item.summary.tokensPerRecall)),
				String(Math.round(item.summary.p50LatencyMs)),
				item.live ? "live LLM" : "heuristic",
			]
		: null;

const headers = [
	"Stage",
	"Recall@5",
	"Recall@10",
	"MRR",
	"nDCG@10",
	"Context P",
	"Tokens/recall",
	"p50 ms",
	"Extract",
];
const rows = [
	row("baseline (before P0 fixes)", payload.baseline),
	row("after P0 fixes", payload["after-fixes"]),
].filter((item): item is string[] => item !== null);
if (rows.length === 0) {
	const current = row(stage, snapshot);
	if (current) {
		rows.push(current);
	}
}

const table = [
	`| ${headers.join(" | ")} |`,
	`|${headers.map(() => "---").join("|")}|`,
	...rows.map((item) => `| ${item.join(" | ")} |`),
].join("\n");

writeFileSync(
	mdPath,
	`# Recall eval

Labeled retrieval set: \`docs/eval/recall-set.json\` (${set.documents.length} dated documents, ${set.queries.length} queries). Matchers are \`{ contains, kind?, type? }\` because memory ids are not stable across runs. \`asOf\` / \`from\` / \`to\` / \`graph\` tags are present for later phases; P0 scores packed memories against matchers only.

Harness: \`scoreRecall\` in \`packages/memory/src/eval.ts\`, runner \`apps/app/scripts/eval-recall.ts\` (\`bun run eval:recall\`). Deterministic path uses hash embeddings, in-memory Vectorize, and the heuristic extractor so CI can fail fusion/filter/pack regressions without keys.

Live extraction uses OpenRouter (OpenAI fallback) when \`OPENROUTER_API_KEY\` / \`OPENAI_API_KEY\` are set. Embeddings stay hash in this bun runner; workerd tests cover the Vectorize emulator.

Raw numbers: \`docs/eval/recall-results.json\`. Set \`EVAL_STAGE=baseline\` or \`EVAL_STAGE=after-fixes\` when recording a phase.

## Deterministic numbers

${table}

P0 records a baseline **before** retrieval changes, then the same table after D1–D5 / D3 / D7. Later phases must not regress Recall@10 or nDCG@10.
`,
);

console.log(`stage=${stage} live=${live}`);
console.log(run.summary);
console.log(`wrote ${resultsPath} and ${mdPath}`);
