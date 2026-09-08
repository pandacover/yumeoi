import type { ConsolidateAction, ExtractedMemory, MemoryKind } from "@yumeoi/domain";

export type ExpectedMemory = {
	readonly kind?: MemoryKind;
	readonly contains: string;
	readonly optional?: boolean;
};

export type EvalDocument = {
	readonly id: string;
	readonly title: string;
	readonly markdown: string;
	readonly expected: ReadonlyArray<ExpectedMemory>;
};

export type ConsolidateCase = {
	readonly id: string;
	readonly candidate: string;
	readonly existing: ReadonlyArray<{ readonly id: string; readonly text: string }>;
	readonly expected: { readonly action: ConsolidateAction; readonly targetId: string | null };
};

export type RerankCase = {
	readonly id: string;
	readonly query: string;
	readonly candidates: ReadonlyArray<{ readonly id: string; readonly text: string }>;
	readonly relevant: ReadonlyArray<string>;
};

export type EvalSet = {
	readonly documents: ReadonlyArray<EvalDocument>;
	readonly consolidate: ReadonlyArray<ConsolidateCase>;
	readonly rerank: ReadonlyArray<RerankCase>;
};

export type EvalScore = {
	readonly documentId: string;
	readonly precision: number;
	readonly recall: number;
	readonly f1: number;
	readonly extracted: number;
	readonly expected: number;
	readonly hits: number;
};

export type ExtractionScore = EvalScore;

export type ConsolidateScore = {
	readonly caseId: string;
	readonly correct: boolean;
	readonly predictedAction: ConsolidateAction;
	readonly predictedTargetId: string | null;
};

export type RerankScore = {
	readonly caseId: string;
	readonly ndcg: number;
	readonly top1: boolean;
	readonly complete: boolean;
};

export type EvalTokenTotals = {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly reasoningTokens: number;
	readonly cachedInputTokens: number;
	readonly calls: number;
};

export const emptyTokenTotals = (): EvalTokenTotals => ({
	inputTokens: 0,
	outputTokens: 0,
	reasoningTokens: 0,
	cachedInputTokens: 0,
	calls: 0,
});

export const addTokenTotals = (
	left: EvalTokenTotals,
	right: {
		readonly inputTokens: number;
		readonly outputTokens: number;
		readonly reasoningTokens: number;
		readonly cachedInputTokens?: number;
		readonly calls?: number;
	},
): EvalTokenTotals => ({
	inputTokens: left.inputTokens + right.inputTokens,
	outputTokens: left.outputTokens + right.outputTokens,
	reasoningTokens: left.reasoningTokens + right.reasoningTokens,
	cachedInputTokens: left.cachedInputTokens + (right.cachedInputTokens ?? 0),
	calls: left.calls + (right.calls ?? 1),
});

const normalize = (text: string): string => text.toLowerCase().replace(/\s+/g, " ").trim();

const matchesExpected = (memory: ExtractedMemory, expected: ExpectedMemory): boolean => {
	if (expected.kind && memory.kind !== expected.kind) {
		return false;
	}
	return normalize(memory.text).includes(normalize(expected.contains));
};

const f1 = (precision: number, recall: number): number =>
	precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

export const scoreExtraction = (
	document: EvalDocument,
	extracted: ReadonlyArray<ExtractedMemory>,
): EvalScore => {
	const required = document.expected.filter((item) => !item.optional);
	const hits = document.expected.filter((item) =>
		extracted.some((memory) => matchesExpected(memory, item)),
	).length;
	const requiredHits = required.filter((item) =>
		extracted.some((memory) => matchesExpected(memory, item)),
	).length;
	const truePositives = extracted.filter((memory) =>
		document.expected.some((item) => matchesExpected(memory, item)),
	).length;
	const precision = extracted.length === 0 ? 1 : truePositives / extracted.length;
	const recall = required.length === 0 ? 1 : requiredHits / required.length;
	return {
		documentId: document.id,
		precision,
		recall,
		f1: f1(precision, recall),
		extracted: extracted.length,
		expected: required.length,
		hits,
	};
};

export const scoreConsolidate = (
	item: ConsolidateCase,
	predicted: { readonly action: ConsolidateAction; readonly targetId: string | null },
): ConsolidateScore => {
	const actionOk = predicted.action === item.expected.action;
	const targetOk =
		item.expected.action === "new"
			? predicted.targetId === null
			: predicted.targetId === item.expected.targetId;
	return {
		caseId: item.id,
		correct: actionOk && targetOk,
		predictedAction: predicted.action,
		predictedTargetId: predicted.targetId,
	};
};

export const scoreRerank = (item: RerankCase, predictedIds: ReadonlyArray<string>): RerankScore => {
	const candidateIds = item.candidates.map((candidate) => candidate.id);
	const complete =
		predictedIds.length === candidateIds.length &&
		new Set(predictedIds).size === candidateIds.length &&
		candidateIds.every((id) => predictedIds.includes(id));
	const relevant = new Set(item.relevant);
	const dcg = predictedIds.reduce((sum, id, index) => {
		const rel = relevant.has(id) ? 1 : 0;
		return sum + rel / Math.log2(index + 2);
	}, 0);
	const ideal = [...item.relevant, ...candidateIds.filter((id) => !relevant.has(id))];
	const idcg = ideal.reduce((sum, id, index) => {
		const rel = relevant.has(id) ? 1 : 0;
		return sum + rel / Math.log2(index + 2);
	}, 0);
	return {
		caseId: item.id,
		ndcg: idcg === 0 ? 1 : dcg / idcg,
		top1: predictedIds[0] !== undefined && relevant.has(predictedIds[0]),
		complete,
	};
};

export const mean = (values: ReadonlyArray<number>): number =>
	values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

export const summarizeScores = (scores: ReadonlyArray<EvalScore>) => {
	const n = scores.length || 1;
	return {
		documents: scores.length,
		precision: scores.reduce((sum, score) => sum + score.precision, 0) / n,
		recall: scores.reduce((sum, score) => sum + score.recall, 0) / n,
		f1: scores.reduce((sum, score) => sum + score.f1, 0) / n,
	};
};

export const summarizeExtraction = summarizeScores;

export const summarizeConsolidate = (scores: ReadonlyArray<ConsolidateScore>) => ({
	cases: scores.length,
	accuracy: mean(scores.map((score) => (score.correct ? 1 : 0))),
});

export const summarizeRerank = (scores: ReadonlyArray<RerankScore>) => ({
	cases: scores.length,
	ndcg: mean(scores.map((score) => score.ndcg)),
	top1: mean(scores.map((score) => (score.top1 ? 1 : 0))),
	complete: mean(scores.map((score) => (score.complete ? 1 : 0))),
});
