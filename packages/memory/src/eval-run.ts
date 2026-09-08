import type { LlmJobConfig, LlmUsage } from "@yumeoi/domain";
import { Effect } from "effect";
import { Consolidator } from "./consolidator.ts";
import {
	addTokenTotals,
	type EvalDocument,
	type EvalScore,
	type EvalTokenTotals,
	emptyTokenTotals,
	scoreExtraction,
	summarizeScores,
} from "./eval.ts";
import { Extractor } from "./extractor.ts";
import { Llm } from "./llm.ts";

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
				{
					id: "existing-1",
					kind: first.kind,
					text: first.text,
					confidence: first.confidence,
					validFrom: first.validFrom,
					validTo: null,
					supersedes: null,
				},
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
