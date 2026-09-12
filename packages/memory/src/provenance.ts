import type { MemoryHit, MemoryOrigin, Provenance } from "@yumeoi/domain";

const sourceKey = (sourceId: string): string => sourceId.toLowerCase();

const hasPrefix = (sourceId: string, prefix: string): boolean => {
	const source = sourceKey(sourceId);
	return source === prefix || source.startsWith(`${prefix}:`);
};

export const provenanceBelongsToOrigin = (row: Provenance, origin: MemoryOrigin): boolean => {
	switch (origin) {
		case "agent":
			return hasPrefix(row.sourceId, "agent");
		case "user":
			return hasPrefix(row.sourceId, "user");
		case "derived":
			return hasPrefix(row.sourceId, "derived");
		case "chat":
			return hasPrefix(row.sourceId, "chat");
		case "extracted":
			return (
				!hasPrefix(row.sourceId, "agent") &&
				!hasPrefix(row.sourceId, "user") &&
				!hasPrefix(row.sourceId, "derived") &&
				!hasPrefix(row.sourceId, "chat")
			);
	}
};

export const orderProvenanceForOrigin = (
	origin: MemoryOrigin,
	rows: ReadonlyArray<Provenance>,
): Provenance[] => {
	const matching: Provenance[] = [];
	const rest: Provenance[] = [];
	for (const row of rows) {
		if (provenanceBelongsToOrigin(row, origin)) {
			matching.push(row);
		} else {
			rest.push(row);
		}
	}
	return [...matching, ...rest];
};

export const citationSource = (
	origin: MemoryOrigin,
	provenance: ReadonlyArray<Provenance>,
): Provenance | null => {
	const ordered = orderProvenanceForOrigin(origin, provenance);
	if (origin === "extracted") {
		return ordered[0] ?? null;
	}
	return ordered.find((row) => provenanceBelongsToOrigin(row, origin)) ?? null;
};

export const citationSourceForHit = (hit: MemoryHit): Provenance | null =>
	citationSource(hit.memory.origin, hit.provenance);

const NOTES_TITLES = new Set(["agent notes", "agent writes", "derived notes", "chat notes"]);

const quoteProvenance = (row: Provenance): string =>
	row.title ? JSON.stringify(row.title) : row.sourceId;

const uniqueQuotes = (rows: ReadonlyArray<Provenance>): string[] => {
	const seen = new Set<string>();
	const quotes: string[] = [];
	for (const row of rows) {
		if (row.title && NOTES_TITLES.has(row.title.toLowerCase())) {
			continue;
		}
		const quote = quoteProvenance(row);
		if (seen.has(quote)) {
			continue;
		}
		seen.add(quote);
		quotes.push(quote);
	}
	return quotes;
};

/** Packed-line cite: origin always, `src` only when the document actually sourced the text. */
export const formatMemoryCite = (
	origin: MemoryOrigin,
	provenance: ReadonlyArray<Provenance>,
): string => {
	const ordered = orderProvenanceForOrigin(origin, provenance);
	const matching = ordered.filter((row) => provenanceBelongsToOrigin(row, origin));
	const related = ordered.filter((row) => !provenanceBelongsToOrigin(row, origin));
	if (origin === "extracted") {
		const srcs = uniqueQuotes(matching.length > 0 ? matching : ordered);
		return srcs.length > 0 ? `${origin}·src ${srcs.join("; ")}` : origin;
	}
	const originSrcs = uniqueQuotes(matching);
	const also = uniqueQuotes(related);
	if (originSrcs.length > 0 && also.length > 0) {
		return `${origin}·src ${originSrcs.join("; ")}; also ${also.join("; ")}`;
	}
	if (originSrcs.length > 0) {
		return `${origin}·src ${originSrcs.join("; ")}`;
	}
	if (also.length > 0) {
		return `${origin}; also ${also.join("; ")}`;
	}
	return origin;
};

export const mergeCitationOrigin = (
	target: MemoryOrigin,
	incoming: MemoryOrigin,
	textChanged: boolean,
): MemoryOrigin => {
	if (!textChanged) {
		return target;
	}
	if (incoming !== "extracted") {
		return incoming;
	}
	if (target !== "extracted") {
		return target;
	}
	return "extracted";
};

export const rewriteCitationOrigin = (current: MemoryOrigin): MemoryOrigin =>
	current === "extracted" ? "agent" : current;
