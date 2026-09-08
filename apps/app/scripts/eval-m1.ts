import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openaiGatewayLlmLayer } from "@yumeoi/cf-runtime/llm-openai";
import {
	CONSOLIDATE_EVAL_CANDIDATES,
	defaultLlmConfig,
	EXTRACT_EVAL_CANDIDATES,
	type LlmConfig,
	type LlmJobConfig,
	RERANK_EVAL_CANDIDATES,
	RerankResult,
	rerankResultJsonSchema,
} from "@yumeoi/domain";
import {
	consolidatorLayer,
	type EvalDocument,
	evaluateConsolidation,
	evaluateExtraction,
	extractorLayer,
	heuristicLlmLayer,
	Llm,
} from "@yumeoi/memory";
import { Effect, Layer } from "effect";

const root = resolve(import.meta.dir, "../../..");
const setPath = resolve(root, "docs/eval/m1-set.json");
const resultsPath = resolve(root, "docs/eval/m1-results.json");
const mdPath = resolve(root, "docs/eval/m1.md");

const set = JSON.parse(readFileSync(setPath, "utf8")) as { documents: EvalDocument[] };

const apiKey = process.env.OPENAI_API_KEY;
const baseURL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

const withJob = (job: "extract" | "consolidate" | "rerank", config: LlmJobConfig): LlmConfig => ({
	...defaultLlmConfig,
	[job]: config,
});

const llmLayer = (config: LlmConfig) =>
	apiKey ? openaiGatewayLlmLayer({ apiKey, baseURL, config }) : heuristicLlmLayer;

const serviceLayer = (config: LlmConfig) => {
	const llm = llmLayer(config);
	return Layer.mergeAll(
		llm,
		Layer.provide(extractorLayer, llm),
		Layer.provide(consolidatorLayer, llm),
	);
};

const round = (value: number) => Math.round(value * 1000) / 1000;

type ExtractSweep = Awaited<ReturnType<typeof runExtractSweep>>[number];
type ConsolidateSweep = Awaited<ReturnType<typeof runConsolidateSweep>>[number];
type RerankSweep = Awaited<ReturnType<typeof runRerankSweep>>[number];

const runExtractSweep = async () => {
	const out = [];
	for (const candidate of EXTRACT_EVAL_CANDIDATES) {
		const result = await Effect.runPromise(
			evaluateExtraction(set.documents).pipe(
				Effect.provide(serviceLayer(withJob("extract", candidate))),
			),
		);
		out.push(result);
		console.log(
			`extract ${candidate.model}/${candidate.effort} P=${round(result.summary.precision)} R=${round(result.summary.recall)} in=${result.usage.inputTokens} out=${result.usage.outputTokens} reasoning=${result.usage.reasoningTokens}`,
		);
	}
	return out;
};

const runConsolidateSweep = async () => {
	const out = [];
	for (const candidate of CONSOLIDATE_EVAL_CANDIDATES) {
		const result = await Effect.runPromise(
			evaluateConsolidation(set.documents).pipe(
				Effect.provide(serviceLayer(withJob("consolidate", candidate))),
			),
		);
		out.push(result);
		console.log(
			`consolidate ${candidate.model}/${candidate.effort} new=${round(result.newAccuracy)} dup=${round(result.duplicateAccuracy)} in=${result.usage.inputTokens} out=${result.usage.outputTokens} reasoning=${result.usage.reasoningTokens}`,
		);
	}
	return out;
};

const runRerankSweep = async () => {
	const gold = "mem-gold";
	const distractors = ["mem-a", "mem-b", "mem-c"];
	const user = `Query: Effect 4 preference\n\n${gold}: Luv prefers Effect 4 for the yumeoi domain layer.\n${distractors[0]}: The kickoff is tomorrow.\n${distractors[1]}: Skip attachments for v0.\n${distractors[2]}: Namespaces are the user id.`;
	const out = [];
	for (const candidate of RERANK_EVAL_CANDIDATES) {
		const llm = llmLayer(withJob("rerank", candidate));
		const started = Date.now();
		const ranked = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* Llm;
				yield* service.drainUsage();
				const result = yield* service.structured({
					job: "rerank",
					schema: RerankResult,
					schemaName: "rerank_result",
					jsonSchema: rerankResultJsonSchema(),
					system: "Reorder memory ids by relevance to the query. Return every id exactly once.",
					user,
				});
				const usage = yield* service.drainUsage();
				return { result, usage };
			}).pipe(Effect.provide(llm)),
		);
		const latencyMs = Date.now() - started;
		const top = ranked.result.ids[0];
		const usage = ranked.usage.reduce(
			(totals, row) => ({
				inputTokens: totals.inputTokens + row.inputTokens,
				outputTokens: totals.outputTokens + row.outputTokens,
				reasoningTokens: totals.reasoningTokens + row.reasoningTokens,
				cachedInputTokens: totals.cachedInputTokens + row.cachedInputTokens,
				calls: totals.calls + 1,
			}),
			{ inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedInputTokens: 0, calls: 0 },
		);
		out.push({
			job: "rerank" as const,
			model: candidate.model,
			effort: candidate.effort,
			topId: top ?? null,
			goldFirst: top === gold,
			latencyMs,
			usage,
		});
		console.log(
			`rerank ${candidate.model}/${candidate.effort} goldFirst=${top === gold} latencyMs=${latencyMs} in=${usage.inputTokens} out=${usage.outputTokens} reasoning=${usage.reasoningTokens}`,
		);
	}
	return out;
};

const pickExtractWinner = (runs: ExtractSweep) => {
	const scored = runs.map((run) => ({
		run,
		quality: (run.summary.precision + run.summary.recall) / 2,
		cost: run.usage.inputTokens + run.usage.outputTokens + run.usage.reasoningTokens,
	}));
	scored.sort((a, b) => b.quality - a.quality || a.cost - b.cost);
	return scored[0]?.run;
};

const pickConsolidateWinner = (runs: ConsolidateSweep, extractWinner?: ExtractSweep) => {
	const scored = runs.map((run) => ({
		run,
		quality: (run.newAccuracy + run.duplicateAccuracy) / 2,
		cost: run.usage.inputTokens + run.usage.outputTokens + run.usage.reasoningTokens,
		sameAsExtract: extractWinner
			? run.model === extractWinner.model && run.effort === extractWinner.effort
			: false,
	}));
	scored.sort(
		(a, b) =>
			b.quality - a.quality || Number(b.sameAsExtract) - Number(a.sameAsExtract) || a.cost - b.cost,
	);
	return scored[0]?.run;
};

const pickRerankWinner = (runs: RerankSweep) => {
	const scored = [...runs].sort(
		(a, b) =>
			Number(b.goldFirst) - Number(a.goldFirst) ||
			a.latencyMs - b.latencyMs ||
			a.usage.outputTokens - b.usage.outputTokens,
	);
	return scored[0];
};

const table = (headers: string[], rows: string[][]) => {
	const head = `| ${headers.join(" | ")} |`;
	const sep = `|${headers.map(() => "---").join("|")}|`;
	return [head, sep, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
};

const renderMarkdown = (payload: {
	readonly live: boolean;
	readonly extract: ExtractSweep;
	readonly consolidate: ConsolidateSweep;
	readonly rerank: RerankSweep;
	readonly pins: {
		extract: LlmJobConfig;
		consolidate: LlmJobConfig;
		rerank: LlmJobConfig;
	};
}) => {
	const extractRows = payload.extract.map((run) => [
		`${run.model} \`${run.effort}\``,
		String(round(run.summary.precision)),
		String(round(run.summary.recall)),
		String(run.usage.inputTokens),
		String(run.usage.outputTokens),
		String(run.usage.reasoningTokens),
		String(run.usage.calls),
	]);
	const consolidateRows = payload.consolidate.map((run) => [
		`${run.model} \`${run.effort}\``,
		String(round(run.newAccuracy)),
		String(round(run.duplicateAccuracy)),
		String(run.usage.inputTokens),
		String(run.usage.outputTokens),
		String(run.usage.reasoningTokens),
	]);
	const rerankRows = payload.rerank.map((run) => [
		`${run.model} \`${run.effort}\``,
		run.goldFirst ? "yes" : "no",
		String(run.latencyMs),
		String(run.usage.inputTokens),
		String(run.usage.outputTokens),
		String(run.usage.reasoningTokens),
	]);
	return `# M1 model decision

Extraction, consolidation, and rerank stay on OpenAI via AI Gateway (v0 decision 3). Chat remains GPT-5.6 Luna at reasoning effort \`high\`.

This milestone pins the other three jobs from the eval set in \`m1-set.json\` (${set.documents.length} hand-labeled documents, all six memory kinds). The harness is \`packages/memory/src/eval.ts\` / \`eval-run.ts\`. Live numbers below were produced by \`bun run eval:m1\`${payload.live ? " against OpenAI" : " with the heuristic extractor (no OPENAI_API_KEY)"}.

Per-document input, output, and reasoning tokens are in \`docs/eval/m1-results.json\`.

## Extract

${table(["Candidate", "Precision", "Recall", "Input", "Output", "Reasoning", "Calls"], extractRows)}

## Consolidate

${table(["Candidate", "New acc.", "Duplicate acc.", "Input", "Output", "Reasoning"], consolidateRows)}

## Rerank

${table(["Candidate", "Gold first", "Latency ms", "Input", "Output", "Reasoning"], rerankRows)}

## Pins

| Job | Model | Effort | Why |
|---|---|---|---|
| chat | \`gpt-5.6-luna\` | \`high\` | already locked |
| extract | \`${payload.pins.extract.model}\` | \`${payload.pins.extract.effort}\` | measured on the labeled set; volume job so cheaper effort wins when quality is close |
| consolidate | \`${payload.pins.consolidate.model}\` | \`${payload.pins.consolidate.effort}\` | short enum; prefer sharing extract's model for prompt cache |
| rerank | \`${payload.pins.rerank.model}\` | \`${payload.pins.rerank.effort}\` | on the chat/recall latency path |

Config: \`defaultLlmConfig\` in \`packages/domain/src/llm.ts\`. Re-run \`bun run eval:m1\` on a keyed preview before changing pins.
`;
};

const extract = await runExtractSweep();
const consolidate = await runConsolidateSweep();
const rerank = await runRerankSweep();
const extractWinner = pickExtractWinner(extract);
const consolidateWinner = pickConsolidateWinner(consolidate, extractWinner);
const rerankWinner = pickRerankWinner(rerank);

const pins = {
	extract: extractWinner
		? { model: extractWinner.model, effort: extractWinner.effort }
		: defaultLlmConfig.extract,
	consolidate: consolidateWinner
		? { model: consolidateWinner.model, effort: consolidateWinner.effort }
		: defaultLlmConfig.consolidate,
	rerank: rerankWinner
		? { model: rerankWinner.model, effort: rerankWinner.effort }
		: defaultLlmConfig.rerank,
};

const payload = {
	live: Boolean(apiKey),
	generatedAt: new Date().toISOString(),
	extract,
	consolidate,
	rerank,
	pins,
};

writeFileSync(resultsPath, `${JSON.stringify(payload, null, 2)}\n`);
writeFileSync(mdPath, renderMarkdown(payload));
console.log(`wrote ${resultsPath} and ${mdPath}`);
console.log("pins", pins);
if (!apiKey) {
	console.log(
		"OPENAI_API_KEY is unset; pins above are heuristic-only and were not applied to defaultLlmConfig.",
	);
}
