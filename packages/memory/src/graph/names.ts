import type { EntityType, ExtractedEntity, ExtractedRelation } from "@yumeoi/domain";

const NAME_STOP = new Set([
	"the",
	"this",
	"that",
	"when",
	"what",
	"who",
	"how",
	"document",
	"notes",
	"always",
	"never",
	"effect",
	"cloudflare",
	"monday",
	"tuesday",
	"january",
	"february",
	"march",
	"april",
	"june",
	"july",
	"august",
	"september",
	"october",
	"november",
	"december",
]);

export const canonicalName = (name: string): string =>
	name
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/^(the|a|an|mr|ms|mrs|dr)\s+/u, "")
		.trim();

export const guessEntityType = (name: string): EntityType => {
	const lower = name.toLowerCase();
	if (/\b(inc|labs|corp|company|studio)\b/.test(lower)) {
		return "org";
	}
	if (/\b(project |aurora|yumeoi)\b/.test(lower) || lower === "aurora" || lower === "yumeoi") {
		return "project";
	}
	if (/^[A-Z][a-z]+$/.test(name)) {
		return "person";
	}
	return "other";
};

export const extractMentions = (text: string): ReadonlyArray<ExtractedEntity> => {
	const names = [...text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g)].map(
		(match) => match[1] ?? "",
	);
	const unique = [...new Set(names)].filter(
		(name) => name.length >= 3 && !NAME_STOP.has(name.toLowerCase()),
	);
	return unique.slice(0, 8).map((name) => ({ name, type: guessEntityType(name) }));
};

export const extractRelations = (
	text: string,
	entities: ReadonlyArray<ExtractedEntity>,
): ReadonlyArray<ExtractedRelation> => {
	const lower = text.toLowerCase();
	const names = entities.map((entity) => entity.name);
	const relations: ExtractedRelation[] = [];
	for (let i = 0; i < names.length; i++) {
		for (let j = 0; j < names.length; j++) {
			if (i === j) {
				continue;
			}
			const left = names[i] ?? "";
			const right = names[j] ?? "";
			if (new RegExp(`${left}\\s+(?:leads|lead)\\s+(?:Project\\s+)?${right}`, "i").test(text)) {
				relations.push({ subject: left, predicate: "leads", object: right });
			}
			if (new RegExp(`${left}\\s+(?:reports to)\\s+${right}`, "i").test(text)) {
				relations.push({ subject: left, predicate: "reports_to", object: right });
			}
			if (new RegExp(`${left}\\s+(?:owns|owned)\\s+(?:the\\s+)?${right}`, "i").test(text)) {
				relations.push({ subject: left, predicate: "owns", object: right });
			}
			if (new RegExp(`${left}\\s+(?:met|meets|meeting)\\s+.*?${right}`, "i").test(text)) {
				relations.push({ subject: left, predicate: "met", object: right });
			}
			if (
				new RegExp(`${left}\\s+(?:works with|worked with)\\s+.*?${right}`, "i").test(text) ||
				(lower.includes("with") &&
					lower.includes(left.toLowerCase()) &&
					lower.includes(right.toLowerCase()))
			) {
				if (/\bworks with\b|\bworked with\b|\bon .+ with\b/.test(lower)) {
					relations.push({ subject: left, predicate: "works_with", object: right });
				}
			}
		}
	}
	return relations.slice(0, 6);
};

export const properNamesInQuery = (query: string): string[] =>
	extractMentions(query).map((entity) => entity.name);
