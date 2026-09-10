import type { ConsolidateAction, ExtractedMemory, MemoryKind } from "@yumeoi/domain";

export type ExpectedMemory = {
	readonly kind?: MemoryKind;
	readonly type?: MemoryTypeName;
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

export type MemoryTypeName = "semantic" | "episodic" | "procedural";

export type RecallMatcher = {
	readonly contains: string;
	readonly kind?: MemoryKind;
	readonly type?: MemoryTypeName;
};

export type RecallQueryCase = {
	readonly id: string;
	readonly query: string;
	readonly expected: ReadonlyArray<RecallMatcher>;
	readonly asOf?: string;
	readonly from?: string;
	readonly to?: string;
	readonly graph?: boolean;
	readonly tags?: ReadonlyArray<string>;
};

export type RecallCorpusDocument = {
	readonly id: string;
	readonly title: string;
	readonly markdown: string;
	readonly date?: string;
	readonly sourceId?: string;
	readonly sourceLabel?: string;
};

export type RecallSet = {
	readonly documents: ReadonlyArray<RecallCorpusDocument>;
	readonly queries: ReadonlyArray<RecallQueryCase>;
};

export type RecallScore = {
	readonly queryId: string;
	readonly recallAt5: number;
	readonly recallAt10: number;
	readonly mrr: number;
	readonly ndcgAt10: number;
	readonly contextPrecision: number;
	readonly packed: number;
	readonly expected: number;
	readonly tokens: number;
	readonly latencyMs: number;
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
	if (expected.type && memory.type !== expected.type) {
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

const matchesRecall = (
	item: { readonly text: string; readonly kind?: MemoryKind },
	matcher: RecallMatcher,
): boolean => {
	if (matcher.kind && item.kind && matcher.kind !== item.kind) {
		return false;
	}
	return normalize(item.text).includes(normalize(matcher.contains));
};

const ndcgAt = (relevances: ReadonlyArray<number>, k: number, relevantCount: number): number => {
	const dcg = relevances
		.slice(0, k)
		.reduce((sum, rel, index) => sum + rel / Math.log2(index + 2), 0);
	const ideal = Math.min(relevantCount, k);
	const idcg = Array.from({ length: ideal }, (_, index) => 1 / Math.log2(index + 2)).reduce(
		(sum, value) => sum + value,
		0,
	);
	return idcg === 0 ? 1 : dcg / idcg;
};

export const scoreRecall = (
	query: RecallQueryCase,
	packed: ReadonlyArray<{ readonly text: string; readonly kind?: MemoryKind }>,
	usage?: { readonly tokens: number; readonly latencyMs: number },
): RecallScore => {
	const expected = query.expected;
	const recallAt = (k: number): number => {
		if (expected.length === 0) {
			return 1;
		}
		const hits = expected.filter((matcher) =>
			packed.slice(0, k).some((item) => matchesRecall(item, matcher)),
		).length;
		return hits / expected.length;
	};
	const firstHit = packed.findIndex((item) =>
		expected.some((matcher) => matchesRecall(item, matcher)),
	);
	const mrr = expected.length === 0 ? 1 : firstHit < 0 ? 0 : 1 / (firstHit + 1);
	const relevances = packed.map((item) =>
		expected.some((matcher) => matchesRecall(item, matcher)) ? 1 : 0,
	);
	const relevantPacked = relevances.filter((rel) => rel > 0).length;
	const emptyPrecision = expected.length === 0 ? 1 : 0;
	return {
		queryId: query.id,
		recallAt5: recallAt(5),
		recallAt10: recallAt(10),
		mrr,
		ndcgAt10: ndcgAt(relevances, 10, expected.length),
		contextPrecision: packed.length === 0 ? emptyPrecision : relevantPacked / packed.length,
		packed: packed.length,
		expected: expected.length,
		tokens: usage?.tokens ?? 0,
		latencyMs: usage?.latencyMs ?? 0,
	};
};

export const summarizeRecall = (scores: ReadonlyArray<RecallScore>) => ({
	queries: scores.length,
	recallAt5: mean(scores.map((score) => score.recallAt5)),
	recallAt10: mean(scores.map((score) => score.recallAt10)),
	mrr: mean(scores.map((score) => score.mrr)),
	ndcgAt10: mean(scores.map((score) => score.ndcgAt10)),
	contextPrecision: mean(scores.map((score) => score.contextPrecision)),
	tokensPerRecall: mean(scores.map((score) => score.tokens)),
	p50LatencyMs: percentile(
		scores.map((score) => score.latencyMs),
		0.5,
	),
});

export const percentile = (values: ReadonlyArray<number>, p: number): number => {
	if (values.length === 0) {
		return 0;
	}
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
	return sorted[index] ?? 0;
};

export type TypesCase = {
	readonly id: string;
	readonly text: string;
	readonly type: MemoryTypeName;
	readonly kind?: MemoryKind;
};

export type TypesSet = {
	readonly statements: ReadonlyArray<TypesCase>;
};

export type ClassificationScore = {
	readonly caseId: string;
	readonly expected: MemoryTypeName;
	readonly predicted: MemoryTypeName;
	readonly correct: boolean;
};

export const scoreClassification = (
	item: TypesCase,
	predicted: MemoryTypeName,
): ClassificationScore => ({
	caseId: item.id,
	expected: item.type,
	predicted,
	correct: predicted === item.type,
});

const MEMORY_TYPE_NAMES: ReadonlyArray<MemoryTypeName> = ["semantic", "episodic", "procedural"];

export const summarizeClassification = (scores: ReadonlyArray<ClassificationScore>) => {
	const confusion = Object.fromEntries(
		MEMORY_TYPE_NAMES.map((expected) => [
			expected,
			Object.fromEntries(MEMORY_TYPE_NAMES.map((predicted) => [predicted, 0])),
		]),
	) as Record<MemoryTypeName, Record<MemoryTypeName, number>>;
	for (const score of scores) {
		confusion[score.expected][score.predicted] += 1;
	}
	return {
		cases: scores.length,
		accuracy: mean(scores.map((score) => (score.correct ? 1 : 0))),
		confusion,
	};
};

export type EntityPair = {
	readonly id: string;
	readonly left: {
		readonly name: string;
		readonly type: "person" | "org" | "project" | "place" | "tool" | "topic" | "document" | "other";
	};
	readonly right: {
		readonly name: string;
		readonly type: "person" | "org" | "project" | "place" | "tool" | "topic" | "document" | "other";
	};
	readonly same: boolean;
};

export type EntitiesSet = {
	readonly pairs: ReadonlyArray<EntityPair>;
};

export type ResolutionScore = {
	readonly caseId: string;
	readonly expectedSame: boolean;
	readonly predictedSame: boolean;
	readonly correct: boolean;
};

export const scoreResolution = (pair: EntityPair, predictedSame: boolean): ResolutionScore => ({
	caseId: pair.id,
	expectedSame: pair.same,
	predictedSame,
	correct: predictedSame === pair.same,
});

export const summarizeResolution = (scores: ReadonlyArray<ResolutionScore>) => {
	let tp = 0;
	let fp = 0;
	let fn = 0;
	let tn = 0;
	for (const score of scores) {
		if (score.predictedSame && score.expectedSame) {
			tp += 1;
		} else if (score.predictedSame && !score.expectedSame) {
			fp += 1;
		} else if (!score.predictedSame && score.expectedSame) {
			fn += 1;
		} else {
			tn += 1;
		}
	}
	return {
		cases: scores.length,
		precision: tp + fp === 0 ? 1 : tp / (tp + fp),
		recall: tp + fn === 0 ? 1 : tp / (tp + fn),
		accuracy: mean(scores.map((score) => (score.correct ? 1 : 0))),
		truePositives: tp,
		falsePositives: fp,
		falseNegatives: fn,
		trueNegatives: tn,
	};
};
