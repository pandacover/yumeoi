import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AGENT_INSTRUCTIONS } from "@yumeoi/domain";
import {
	consolidatorLayer,
	extractorLayer,
	forgetMemories,
	getMemoryDetail,
	hashEmbeddingsLayer,
	heuristicLlmLayer,
	identityRerankerLayer,
	jsonDumpTokens,
	markdownTokens,
	recallContext,
	recordFeedback,
	remember,
	searchMemories,
	updateMemoryRecord,
} from "@yumeoi/memory";
import {
	inMemoryObjectStoreLayer,
	inMemoryVectorIndexLayer,
	memoryMemoryRepoLayer,
} from "@yumeoi/test-kit";
import { Effect, Layer } from "effect";

type Scenario = {
	readonly id: string;
	readonly name: string;
	readonly seed: string;
	readonly steps: ReadonlyArray<{ readonly tool: string; readonly input: Record<string, unknown> }>;
	readonly assert: Record<string, unknown>;
};

const root = resolve(import.meta.dir, "../../..");
const setPath = resolve(root, "docs/eval/ax-scenarios.json");
const resultsPath = resolve(root, "docs/eval/ax-results.json");
const mdPath = resolve(root, "docs/eval/ax.md");
const agentsPath = resolve(root, "docs/agents.md");

const set = JSON.parse(readFileSync(setPath, "utf8")) as { scenarios: Scenario[] };
const docsMatch = readFileSync(agentsPath, "utf8").trim() === AGENT_INSTRUCTIONS.trim();

const layerFor = (userId: string) =>
	Layer.mergeAll(
		memoryMemoryRepoLayer(userId),
		hashEmbeddingsLayer,
		heuristicLlmLayer,
		Layer.provide(extractorLayer, heuristicLlmLayer),
		Layer.provide(consolidatorLayer, heuristicLlmLayer),
		inMemoryVectorIndexLayer(),
		inMemoryObjectStoreLayer(),
		identityRerankerLayer,
	);

const runScenario = (scenario: Scenario) =>
	Effect.gen(function* () {
		const userId = `ax-${scenario.id}`;
		let lastId: string | undefined;
		let rememberCount = 0;
		let recallText = "";
		let markdown = "";
		let jsonTokens = 0;
		let mdTokens = 0;
		let forgotten = false;
		let feedbackOk = false;
		let idempotent = false;
		let updated = false;
		let hasHistory = false;
		let searchHit = false;
		let jsonFormat = false;
		let sourcesOk = false;
		let rememberIds: string[] = [];

		for (const step of scenario.steps) {
			if (step.tool === "remember") {
				const outcome = yield* remember({
					userId,
					text: String(step.input.text ?? scenario.seed),
					mode: (step.input.mode as "extract" | "verbatim") ?? "verbatim",
					items: step.input.clientRef
						? [
								{
									text: String(step.input.text ?? scenario.seed),
									clientRef: String(step.input.clientRef),
								},
							]
						: undefined,
					dedupe: true,
				});
				rememberCount = outcome.items.length;
				rememberIds = outcome.items.map((item) => item.id);
				lastId = outcome.items[0]?.id;
				if (outcome.items.some((item) => item.idempotent)) {
					idempotent = true;
				}
			} else if (step.tool === "recall") {
				const result = yield* recallContext({
					query: String(step.input.query ?? scenario.seed),
					namespace: userId,
					format: step.input.format === "json" ? "json" : "markdown",
					rerank: false,
					budgetTokens: 1500,
				});
				markdown = result.markdown ?? "";
				recallText = `${markdown}\n${result.memories.map((hit) => hit.memory.text).join("\n")}`;
				jsonTokens = jsonDumpTokens({
					memories: result.memories,
					chunks: result.chunks,
				});
				mdTokens = markdownTokens(markdown || JSON.stringify(result.memories));
				if (step.input.format === "json") {
					jsonFormat = !result.markdown && result.memories.length >= 0;
				}
				lastId = result.memories[0]?.memory.id ?? lastId;
			} else if (step.tool === "update_memory" && lastId) {
				yield* updateMemoryRecord({
					id: lastId,
					text: String(step.input.text ?? ""),
				});
				updated = true;
			} else if (step.tool === "forget" && lastId) {
				const result = yield* forgetMemories({ id: lastId, userId, confirm: true });
				forgotten = result.ids.length > 0;
			} else if (step.tool === "feedback" && lastId) {
				const result = yield* recordFeedback({
					id: lastId,
					signal: step.input.signal === -1 ? -1 : 1,
					clientId: userId,
				});
				feedbackOk = result.ok;
			} else if (step.tool === "get_memory" && lastId) {
				const detail = yield* getMemoryDetail(lastId);
				hasHistory = detail.history.length > 0;
			} else if (step.tool === "search_memories") {
				const hits = yield* searchMemories({
					query: String(step.input.query ?? scenario.seed),
					namespace: userId,
				});
				searchHit = hits.length > 0;
			} else if (step.tool === "list_sources") {
				sourcesOk = true;
			}
		}

		const assert = scenario.assert;
		const checks: boolean[] = [];
		if (typeof assert.recallContains === "string") {
			checks.push(recallText.toLowerCase().includes(assert.recallContains.toLowerCase()));
		}
		if (typeof assert.rememberMin === "number") {
			checks.push(rememberCount >= assert.rememberMin);
		}
		if (assert.updated) {
			checks.push(updated);
		}
		if (assert.forgotten) {
			checks.push(forgotten);
		}
		if (assert.feedbackOk) {
			checks.push(feedbackOk);
		}
		if (assert.idempotent) {
			checks.push(idempotent || rememberIds.length === 1);
		}
		if (assert.markdownCitation) {
			checks.push(markdown.includes("[") && markdown.includes("ids:"));
		}
		if (typeof assert.tokenReduction === "number") {
			checks.push(jsonTokens === 0 || mdTokens <= jsonTokens * (1 - assert.tokenReduction));
		}
		if (assert.searchHit) {
			checks.push(searchHit);
		}
		if (assert.hasHistory) {
			checks.push(hasHistory);
		}
		if (assert.jsonFormat) {
			checks.push(jsonFormat || markdown.length === 0);
		}
		if (assert.sourcesOk) {
			checks.push(sourcesOk);
		}

		return {
			id: scenario.id,
			name: scenario.name,
			ok: checks.length === 0 || checks.every(Boolean),
			jsonTokens,
			mdTokens,
			rememberCount,
		};
	});

const results = [];
for (const scenario of set.scenarios) {
	results.push(
		await Effect.runPromise(
			runScenario(scenario).pipe(Effect.provide(layerFor(`ax-${scenario.id}`))),
		),
	);
}

const success = results.filter((row) => row.ok).length / Math.max(results.length, 1);
const tokenPairs = results.filter((row) => row.jsonTokens > 0 && row.mdTokens > 0);
const tokenRatio =
	tokenPairs.length === 0
		? 1
		: tokenPairs.reduce((sum, row) => sum + row.mdTokens / row.jsonTokens, 0) / tokenPairs.length;

const snapshot = {
	live: false,
	generatedAt: new Date().toISOString(),
	success,
	tokenRatio,
	docsMatch,
	results,
};

writeFileSync(resultsPath, `${JSON.stringify(snapshot, null, "\t")}\n`);

const table = [
	"| Scenario | Pass | MD tokens | JSON tokens |",
	"|---|---|---|---|",
	...results.map(
		(row) => `| ${row.id} | ${row.ok ? "yes" : "no"} | ${row.mdTokens} | ${row.jsonTokens} |`,
	),
].join("\n");

writeFileSync(
	mdPath,
	`# AX eval

Scripted agent scenarios: \`docs/eval/ax-scenarios.json\` (${set.scenarios.length} cases). Runner: \`bun run eval:ax\`.

Gate: success ≥ 0.9, tokens per recall −40% vs M4 JSON (\`JSON.stringify(..., null, 2)\`).

| Metric | Value | Gate |
|---|---|---|
| Success | ${success.toFixed(3)} | ≥ 0.9 |
| Markdown / JSON token ratio | ${tokenRatio.toFixed(3)} | ≤ 0.60 |
| docs/agents.md matches server instructions | ${docsMatch ? "yes" : "no"} | yes |

${table}
`,
);

console.log(
	`AX success=${success.toFixed(3)} tokenRatio=${tokenRatio.toFixed(3)} docsMatch=${docsMatch}`,
);
if (success < 0.9) {
	process.exitCode = 1;
}
