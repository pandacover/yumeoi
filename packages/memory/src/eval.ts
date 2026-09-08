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

export type ExtractionScore = {
	readonly documentId: string;
	readonly precision: number;
	readonly recall: number;
	readonly f1: number;
	readonly extracted: number;
	readonly expected: number;
	readonly hits: number;
};

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
): ExtractionScore => {
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

export const summarizeExtraction = (scores: ReadonlyArray<ExtractionScore>) => ({
	documents: scores.length,
	precision: mean(scores.map((score) => score.precision)),
	recall: mean(scores.map((score) => score.recall)),
	f1: mean(scores.map((score) => score.f1)),
});

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

export const EXTRACT_SYSTEM = `You extract atomic memories from a document chunk.

Rules:
- Each memory is one self-contained statement that still makes sense without the chunk.
- Prefer facts, preferences, decisions, tasks, relationships, and events.
- Do not invent details that are not in the chunk.
- confidence is 0-1.
- validFrom is an ISO-8601 date when the chunk states one, otherwise null.
- Return as many distinct memories as the chunk supports, including none.`;

export const CONSOLIDATE_SYSTEM = `You decide how a candidate memory relates to existing memories.

Return:
- action=new if it is a distinct statement
- action=duplicate and targetId=existing id if it repeats an existing memory
- action=supersedes and targetId=existing id if it updates and replaces that memory

Only use an id from the candidate list. If none apply, action=new and targetId=null.`;

export const RERANK_SYSTEM = `Reorder memory ids by relevance to the query. Return every id exactly once.`;
