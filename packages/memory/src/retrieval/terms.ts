/** Ultra-generic tokens that should not dominate hybrid retrieval. */
export const GENERIC_RETRIEVAL_TOKENS = new Set([
	"agent",
	"agents",
	"article",
	"articles",
	"assistant",
	"content",
	"context",
	"contexts",
	"data",
	"database",
	"databases",
	"fact",
	"facts",
	"info",
	"information",
	"knowledge",
	"memories",
	"memory",
	"note",
	"notes",
	"product",
	"products",
	"recall",
	"recalled",
	"remember",
	"store",
	"storage",
	"stuff",
	"system",
	"systems",
	"thing",
	"things",
	"user",
	"users",
	"work",
	"working",
]);

export type WeightedTerm = {
	readonly term: string;
	readonly weight: number;
};

const SPECIFIC_THRESHOLD = 0.5;

export const termSpecificity = (term: string): number => {
	const trimmed = term.trim();
	if (trimmed.length === 0) {
		return 0;
	}
	const lower = trimmed.toLowerCase();
	if (GENERIC_RETRIEVAL_TOKENS.has(lower)) {
		return 0.15;
	}
	if (trimmed.length <= 2) {
		return 0.2;
	}
	let score = Math.min(1.4, 0.35 + trimmed.length * 0.08);
	if (trimmed.includes(" ")) {
		score += 0.45;
	}
	if (/^\p{Lu}/u.test(trimmed) && trimmed.length > 2) {
		score += 0.55;
	}
	return score;
};

export const isSpecificTerm = (term: string): boolean =>
	termSpecificity(term) >= SPECIFIC_THRESHOLD;

export const specificQueryTerms = (terms: ReadonlyArray<string>): string[] =>
	terms.filter((term) => isSpecificTerm(term));

export const isMultiConceptQuery = (terms: ReadonlyArray<string>): boolean =>
	specificQueryTerms(terms).length >= 2;

export const weightQueryTerms = (terms: ReadonlyArray<string>): WeightedTerm[] => {
	const seen = new Set<string>();
	const weighted: WeightedTerm[] = [];
	for (const term of terms) {
		const key = term.trim().toLowerCase();
		if (key.length === 0 || seen.has(key)) {
			continue;
		}
		seen.add(key);
		weighted.push({
			term: term.trim(),
			weight: Math.max(1, Math.round(termSpecificity(term) * 8)),
		});
	}
	return weighted;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const termPresent = (text: string, term: string): boolean => {
	const needle = term.trim().toLowerCase();
	if (needle.length === 0) {
		return false;
	}
	const hay = text.toLowerCase();
	if (needle.includes(" ")) {
		return hay.includes(needle);
	}
	return new RegExp(`\\b${escapeRegExp(needle)}`, "i").test(text);
};

/** Fraction of specific query terms present in `text` (falls back to all terms). */
export const termCoverage = (terms: ReadonlyArray<string>, text: string): number => {
	const specific = specificQueryTerms(terms);
	const used = specific.length > 0 ? specific : terms.filter((term) => term.trim().length > 0);
	if (used.length === 0) {
		return 1;
	}
	return used.filter((term) => termPresent(text, term)).length / used.length;
};

export const coverageMultiplier = (coverage: number, floor: number): number =>
	floor + (1 - floor) * Math.max(0, Math.min(1, coverage));

export const lexicalRerankScores = (
	queryTerms: ReadonlyArray<string>,
	documents: ReadonlyArray<{ readonly id: string; readonly text: string }>,
): Array<{ id: string; score: number }> => {
	const weighted = weightQueryTerms(queryTerms);
	const total = weighted.reduce((sum, term) => sum + term.weight, 0) || 1;
	return documents.map((document) => ({
		id: document.id,
		score:
			weighted.reduce(
				(sum, term) => sum + (termPresent(document.text, term.term) ? term.weight : 0),
				0,
			) / total,
	}));
};
