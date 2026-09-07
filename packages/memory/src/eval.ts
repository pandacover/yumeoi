import type { ExtractedMemory, MemoryKind } from "@yumeoi/domain";

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

export type EvalScore = {
	readonly documentId: string;
	readonly precision: number;
	readonly recall: number;
	readonly extracted: number;
	readonly expected: number;
	readonly hits: number;
};

const normalize = (text: string): string => text.toLowerCase().replace(/\s+/g, " ").trim();

const matchesExpected = (memory: ExtractedMemory, expected: ExpectedMemory): boolean => {
	if (expected.kind && memory.kind !== expected.kind) {
		return false;
	}
	return normalize(memory.text).includes(normalize(expected.contains));
};

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
	return {
		documentId: document.id,
		precision: extracted.length === 0 ? 1 : truePositives / extracted.length,
		recall: required.length === 0 ? 1 : requiredHits / required.length,
		extracted: extracted.length,
		expected: required.length,
		hits,
	};
};

export const summarizeScores = (scores: ReadonlyArray<EvalScore>) => {
	const n = scores.length || 1;
	return {
		documents: scores.length,
		precision: scores.reduce((sum, score) => sum + score.precision, 0) / n,
		recall: scores.reduce((sum, score) => sum + score.recall, 0) / n,
	};
};
