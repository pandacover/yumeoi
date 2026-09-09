import { fillMemory, type LlmJobConfig, type LlmUsage } from "@yumeoi/domain";
import { Effect } from "effect";
import { classifyStatement } from "./classify.ts";
import { Consolidator } from "./consolidator.ts";
import {
	addTokenTotals,
	type EntitiesSet,
	type EvalDocument,
	type EvalScore,
	type EvalTokenTotals,
	emptyTokenTotals,
	type RecallSet,
	scoreClassification,
	scoreExtraction,
	scoreRecall,
	scoreResolution,
	summarizeClassification,
	summarizeRecall,
	summarizeResolution,
	summarizeScores,
	type TypesCase,
} from "./eval.ts";
import { Extractor } from "./extractor.ts";
import { resolveEntity } from "./graph/resolve.ts";
import { ingestDocument } from "./ingest.ts";
import { Llm } from "./llm.ts";
import { recallContext } from "./recall.ts";
import { estimateTokens } from "./rrf.ts";

export type EvalDocumentRun = EvalScore & {
	readonly model: string;
	readonly effort: LlmJobConfig["effort"];
	readonly job: "extract" | "consolidate" | "rerank";
	readonly usage: EvalTokenTotals;
};

const sumUsage = (usages: ReadonlyArray<LlmUsage>): EvalTokenTotals =>
	usages.reduce((totals, usage) => addTokenTotals(totals, usage), emptyTokenTotals());

export const evaluateExtraction = (documents: ReadonlyArray<EvalDocument>) =>
	Effect.gen(function* () {
		const extractor = yield* Extractor;
		const llm = yield* Llm;
		const config = llm.config.extract;
		const runs: EvalDocumentRun[] = [];
		for (const document of documents) {
			yield* llm.drainUsage();
			const memories = yield* extractor.extract(document.markdown, document.title);
			const usage = sumUsage(yield* llm.drainUsage());
			runs.push({
				...scoreExtraction(document, memories),
				model: config.model,
				effort: config.effort,
				job: "extract",
				usage,
			});
		}
		return {
			job: "extract" as const,
			model: config.model,
			effort: config.effort,
			summary: summarizeScores(runs),
			usage: runs.reduce((totals, run) => addTokenTotals(totals, run.usage), emptyTokenTotals()),
			documents: runs,
		};
	});

export const evaluateConsolidation = (documents: ReadonlyArray<EvalDocument>) =>
	Effect.gen(function* () {
		const extractor = yield* Extractor;
		const consolidator = yield* Consolidator;
		const llm = yield* Llm;
		const config = llm.config.consolidate;
		let duplicateHits = 0;
		let duplicateTrials = 0;
		let newHits = 0;
		let newTrials = 0;
		yield* llm.drainUsage();
		for (const document of documents) {
			const memories = yield* extractor.extract(document.markdown, document.title);
			if (memories.length === 0) {
				continue;
			}
			const first = memories[0];
			if (!first) {
				continue;
			}
			newTrials += 1;
			const fresh = yield* consolidator.decide(first.text, []);
			if (fresh.action === "new") {
				newHits += 1;
			}
			duplicateTrials += 1;
			const clone = yield* consolidator.decide(first.text, [
				fillMemory({
					id: "existing-1",
					kind: first.kind,
					text: first.text,
					confidence: first.confidence,
					validFrom: first.validFrom,
					validTo: null,
					supersedes: null,
				}),
			]);
			if (clone.action === "duplicate") {
				duplicateHits += 1;
			}
		}
		const usage = sumUsage(yield* llm.drainUsage());
		return {
			job: "consolidate" as const,
			model: config.model,
			effort: config.effort,
			newAccuracy: newTrials === 0 ? 1 : newHits / newTrials,
			duplicateAccuracy: duplicateTrials === 0 ? 1 : duplicateHits / duplicateTrials,
			newTrials,
			duplicateTrials,
			usage,
		};
	});

export const evaluateRecall = (
	set: RecallSet,
	options?: {
		readonly userId?: string;
		readonly rerank?: boolean;
		readonly budgetTokens?: number;
	},
) =>
	Effect.gen(function* () {
		const userId = options?.userId ?? "recall-eval";
		for (const document of set.documents) {
			const dated =
				document.date && !document.markdown.includes(document.date)
					? `${document.markdown} Document date: ${document.date}.`
					: document.markdown;
			yield* ingestDocument({
				userId,
				request: {
					externalId: document.id,
					title: document.title,
					markdown: dated,
					sourceId: document.sourceId ?? "notes",
					sourceLabel: document.sourceLabel ?? "Notes",
					url: null,
				},
			});
		}

		const scores = [];
		for (const query of set.queries) {
			const started = Date.now();
			const result = yield* recallContext({
				query: query.query,
				namespace: userId,
				sources: [],
				kinds: [],
				since: null,
				budgetTokens: options?.budgetTokens ?? 2000,
				rerank: options?.rerank ?? false,
				...(query.asOf ? { asOf: Date.parse(`${query.asOf}T00:00:00.000Z`) } : {}),
				...(query.from ? { from: Date.parse(`${query.from}T00:00:00.000Z`) } : {}),
				...(query.to ? { to: Date.parse(`${query.to}T00:00:00.000Z`) } : {}),
			});
			const latencyMs = Date.now() - started;
			const packed = result.memories.map((hit) => ({
				text: hit.memory.text,
				kind: hit.memory.kind,
			}));
			const tokens =
				packed.reduce((sum, item) => sum + estimateTokens(item.text), 0) +
				result.chunks.reduce((sum, hit) => sum + estimateTokens(hit.chunk.text), 0);
			scores.push(scoreRecall(query, packed, { tokens, latencyMs }));
		}

		return {
			job: "recall" as const,
			summary: summarizeRecall(scores),
			scores,
		};
	});

export const evaluateClassification = (statements: ReadonlyArray<TypesCase>) =>
	Effect.gen(function* () {
		const llm = yield* Llm;
		const config = llm.config.classify;
		yield* llm.drainUsage();
		const scores = [];
		for (const item of statements) {
			const extracted = yield* classifyStatement(item.text);
			scores.push(scoreClassification(item, extracted.type));
		}
		const usage = sumUsage(yield* llm.drainUsage());
		return {
			job: "classify" as const,
			model: config.model,
			effort: config.effort,
			summary: summarizeClassification(scores),
			usage,
			scores,
		};
	});

export const evaluateResolution = (set: EntitiesSet) =>
	Effect.gen(function* () {
		const scores = [];
		const now = Date.now();
		for (const pair of set.pairs) {
			const left = yield* resolveEntity({
				mention: pair.left,
				namespace: "resolve-eval",
				now,
			});
			const right = yield* resolveEntity({
				mention: pair.right,
				namespace: "resolve-eval",
				now,
			});
			scores.push(scoreResolution(pair, left.id === right.id));
		}
		return {
			job: "resolve" as const,
			summary: summarizeResolution(scores),
			scores,
		};
	});
