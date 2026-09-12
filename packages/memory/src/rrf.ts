export const rrfScore = (
	rankLists: ReadonlyArray<ReadonlyArray<string>>,
	k = 60,
): Map<string, number> => {
	const scores = new Map<string, number>();
	for (const list of rankLists) {
		list.forEach((id, rank) => {
			scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
		});
	}
	return scores;
};

export const recencyBoost = (score: number, timestampMs: number, now = Date.now()): number => {
	const ageDays = Math.max(0, (now - timestampMs) / 86_400_000);
	return score * (1 + 0.15 / (1 + ageDays));
};

export const estimateTokens = (text: string): number => Math.max(1, Math.ceil(text.length / 4));

export type FtsTerm = {
	readonly term: string;
	readonly weight?: number;
};

const quoteFtsTerm = (term: string): string => `"${term.replaceAll('"', "")}"`;

/** FTS5 has no query-time `^` boost; drop generic tokens when specific ones exist. */
const SPECIFIC_FTS_WEIGHT = 4;

export const ftsMatchWeighted = (terms: ReadonlyArray<FtsTerm>): string | null => {
	const clipped = terms
		.map((term) => ({ term: term.term.trim(), weight: term.weight ?? 1 }))
		.filter((term) => term.term.length > 0)
		.slice(0, 16);
	if (clipped.length === 0) {
		return null;
	}
	const unigrams = clipped.filter((term) => !term.term.includes(" "));
	const specific = unigrams.filter((term) => term.weight >= SPECIFIC_FTS_WEIGHT);
	const used = specific.length > 0 ? specific : unigrams.length > 0 ? unigrams : clipped;
	return used.map((term) => quoteFtsTerm(term.term)).join(" OR ");
};

export const parseFtsMatch = (match: string): Array<{ term: string; weight: number }> => {
	if (match.trim().length === 0) {
		return [];
	}
	return match.split(/\s+OR\s+/i).flatMap((part) => {
		const trimmed = part.trim();
		if (trimmed.length === 0) {
			return [];
		}
		const boosted = trimmed.match(/^"([^"]+)"(?:\^([0-9.]+))?$/);
		if (boosted?.[1]) {
			return [{ term: boosted[1], weight: boosted[2] ? Number(boosted[2]) : 1 }];
		}
		const bare = trimmed.match(/^([^"^]+?)(?:\^([0-9.]+))?$/);
		if (bare?.[1]) {
			return [{ term: bare[1].trim(), weight: bare[2] ? Number(bare[2]) : 1 }];
		}
		return [{ term: trimmed.replaceAll('"', ""), weight: 1 }];
	});
};

export const ftsMatchQuery = (query: string): string | null => {
	const stop = new Set(["a", "an", "and", "the", "to", "of", "in", "on", "for", "is", "are"]);
	const tokens = query
		.replace(/[^\p{L}\p{N}\s]+/gu, " ")
		.trim()
		.split(/\s+/)
		.filter((token) => token.length > 0);
	const meaningful = tokens.filter((token) => !stop.has(token.toLowerCase()));
	const used = meaningful.length > 0 ? meaningful : tokens;
	const clipped = used.slice(0, 12);
	if (clipped.length === 0) {
		return null;
	}
	return ftsMatchWeighted(clipped.map((token) => ({ term: token, weight: 1 })));
};
