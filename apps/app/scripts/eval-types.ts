import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gatewayLlmLayer, resolveGatewayLlmProviders } from "@yumeoi/cf-runtime/llm-openai";
import { defaultLlmConfig } from "@yumeoi/domain";
import { evaluateClassification, heuristicLlmLayer, type TypesSet } from "@yumeoi/memory";
import { Effect } from "effect";

const root = resolve(import.meta.dir, "../../..");
const setPath = resolve(root, "docs/eval/types-set.json");
const resultsPath = resolve(root, "docs/eval/types-results.json");
const mdPath = resolve(root, "docs/eval/types.md");
const stage = process.env.EVAL_STAGE ?? "heuristic";

const set = JSON.parse(readFileSync(setPath, "utf8")) as TypesSet;

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

const round = (value: number) => Math.round(value * 1000) / 1000;

const run = await Effect.runPromise(
	evaluateClassification(set.statements).pipe(Effect.provide(llm)),
);

type StageResult = {
	readonly live: boolean;
	readonly generatedAt: string;
	readonly model: string;
	readonly effort: string;
	readonly summary: (typeof run)["summary"];
	readonly usage: (typeof run)["usage"];
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
	model: run.model,
	effort: run.effort,
	summary: run.summary,
	usage: run.usage,
};

const payload = { ...previous, [stage]: snapshot };
writeFileSync(resultsPath, `${JSON.stringify(payload, null, 2)}\n`);

const confusionRow = (expected: "semantic" | "episodic" | "procedural", item?: StageResult) => {
	const row = item?.summary.confusion[expected];
	if (!row) {
		return null;
	}
	return [expected, String(row.semantic), String(row.episodic), String(row.procedural)];
};

const current = payload[stage] ?? snapshot;
const accuracy = round(current.summary.accuracy);
const table = [
	"| Stage | Live | Accuracy | Cases | Model | Effort |",
	"|---|---|---:|---:|---|---|",
	...Object.entries(payload).map(
		([name, item]) =>
			`| ${name} | ${item.live ? "yes" : "no"} | ${round(item.summary.accuracy)} | ${item.summary.cases} | ${item.model} | ${item.effort} |`,
	),
].join("\n");

const confusionHeaders = ["expected \\ predicted", "semantic", "episodic", "procedural"];
const confusionRows = (["semantic", "episodic", "procedural"] as const)
	.map((expected) => confusionRow(expected, current))
	.filter((item): item is string[] => item !== null);
const confusionTable = [
	`| ${confusionHeaders.join(" | ")} |`,
	`|${confusionHeaders.map(() => "---").join("|")}|`,
	...confusionRows.map((item) => `| ${item.join(" | ")} |`),
].join("\n");

writeFileSync(
	mdPath,
	`# Types eval

Labeled classification set: \`docs/eval/types-set.json\` (${set.statements.length} statements, balanced semantic / episodic / procedural, including decisions, recurring tasks, and preference-as-rule cases). Scorer: \`scoreClassification\` in \`packages/memory/src/eval.ts\`. Runner: \`apps/app/scripts/eval-types.ts\` (\`bun run eval:types\`).

The deterministic path uses \`heuristicLlmLayer\` so CI can fail a collapsed classifier without keys. Live classification uses OpenRouter (OpenAI fallback) when \`EVAL_LIVE=1\` and keys are set. P1 gate is live accuracy ≥ 0.85.

Raw numbers: \`docs/eval/types-results.json\`. Set \`EVAL_STAGE=heuristic\` or \`EVAL_STAGE=live\` when recording a phase.

## Numbers

${table}

Current stage \`${stage}\` accuracy **${accuracy}**.

## Confusion (${stage})

${confusionTable}

Classify job pin: Luna \`none\` (\`defaultLlmConfig.classify\`). Re-run with \`EVAL_LIVE=1\` before changing the pin.
`,
);

console.log(`stage=${stage} live=${live} accuracy=${accuracy}`);
console.log(run.summary);
console.log(`wrote ${resultsPath} and ${mdPath}`);
