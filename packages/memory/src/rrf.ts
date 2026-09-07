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

export const ftsMatchQuery = (query: string): string | null => {
	const tokens = query
		.replace(/[^\p{L}\p{N}\s]+/gu, " ")
		.trim()
		.split(/\s+/)
		.filter((token) => token.length > 0)
		.slice(0, 12);
	if (tokens.length === 0) {
		return null;
	}
	return tokens.map((token) => `"${token.replaceAll('"', "")}"`).join(" OR ");
};
