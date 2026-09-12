import {
	type MemoryType,
	type QueryIntent,
	type QueryPlan,
	QueryPlan as QueryPlanSchema,
	queryPlanJsonSchema,
	type RecallQuery,
} from "@yumeoi/domain";
import { Effect } from "effect";
import { properNamesInQuery } from "../graph/names.ts";
import { Llm } from "../llm.ts";
import { MemoryRepo } from "../memory-repo.ts";
import { GENERIC_RETRIEVAL_TOKENS, isSpecificTerm } from "./terms.ts";

const STOPWORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"by",
	"do",
	"did",
	"does",
	"for",
	"from",
	"how",
	"i",
	"in",
	"is",
	"it",
	"of",
	"on",
	"or",
	"the",
	"to",
	"was",
	"were",
	"what",
	"when",
	"who",
	"with",
	"about",
]);

const MS_DAY = 86_400_000;
const MONTHS: Record<string, number> = {
	january: 0,
	february: 1,
	march: 2,
	april: 3,
	may: 4,
	june: 5,
	july: 6,
	august: 7,
	september: 8,
	october: 9,
	november: 10,
	december: 11,
};

const quotedPhrases = (text: string): string[] =>
	[...text.matchAll(/"([^"]+)"/g)].map((match) => match[1]?.trim() ?? "").filter(Boolean);

export const tokenizeQuery = (text: string): string[] => {
	const phrases = quotedPhrases(text);
	const rest = text
		.replace(/"[^"]+"/g, " ")
		.replace(/[^\p{L}\p{N}\s]+/gu, " ")
		.trim()
		.split(/\s+/)
		.filter((token) => token.length >= 2);
	const kept = rest.filter((token) => !STOPWORDS.has(token.toLowerCase()));
	const terms = kept.length > 0 ? kept : rest;
	const bigrams: string[] = [];
	for (let i = 1; i < terms.length; i++) {
		const left = terms[i - 1] ?? "";
		const right = terms[i] ?? "";
		if (
			isSpecificTerm(left) &&
			isSpecificTerm(right) &&
			!GENERIC_RETRIEVAL_TOKENS.has(left.toLowerCase()) &&
			!GENERIC_RETRIEVAL_TOKENS.has(right.toLowerCase())
		) {
			bigrams.push(`${left} ${right}`);
		}
	}
	const specific = terms.filter((term) => isSpecificTerm(term));
	const generic = terms.filter((term) => !isSpecificTerm(term));
	const ordered = [...phrases, ...bigrams, ...specific, ...generic];
	const seen = new Set<string>();
	const unique: string[] = [];
	for (const term of ordered) {
		const key = term.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		unique.push(term);
	}
	return unique.slice(0, 16);
};

const parseTemporal = (text: string, now: number): { from: number | null; to: number | null } => {
	const lower = text.toLowerCase();
	if (/\blast week\b/.test(lower)) {
		return { from: now - 7 * MS_DAY, to: now };
	}
	if (/\blast month\b/.test(lower)) {
		return { from: now - 30 * MS_DAY, to: now };
	}
	if (/\blast year\b/.test(lower)) {
		return { from: now - 365 * MS_DAY, to: now };
	}
	const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
	if (iso?.[1]) {
		const start = Date.parse(`${iso[1]}T00:00:00.000Z`);
		return { from: start, to: start + MS_DAY };
	}
	const month = lower.match(
		/\b(in|during)\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/,
	);
	if (month?.[2]) {
		const yearMatch = lower.match(/\b(20\d{2})\b/);
		const year = yearMatch ? Number(yearMatch[1]) : new Date(now).getUTCFullYear();
		const monthIndex = MONTHS[month[2]] ?? 0;
		const from = Date.UTC(year, monthIndex, 1);
		const to = Date.UTC(year, monthIndex + 1, 1);
		return { from, to };
	}
	return { from: null, to: null };
};

export const detectIntent = (text: string): QueryIntent => {
	const lower = text.toLowerCase();
	if (/\bhow (do i|to|should|can)\b/.test(lower) || /\bprocedure|steps to\b/.test(lower)) {
		return "howto";
	}
	if (
		/\bwhen did\b/.test(lower) ||
		/\bwhat happened\b/.test(lower) ||
		/\bhistory of\b/.test(lower)
	) {
		return "history";
	}
	if (/\bwho\b/.test(lower)) {
		return "who";
	}
	if (text.trim().split(/\s+/).length <= 6) {
		return "lookup";
	}
	return "open";
};

export const typeWeightsFor = (intent: QueryIntent): QueryPlan["typeWeights"] => {
	if (intent === "howto") {
		return { semantic: 1, episodic: 0.7, procedural: 1.4 };
	}
	if (intent === "history") {
		return { semantic: 0.8, episodic: 1.4, procedural: 0.6 };
	}
	if (intent === "who") {
		return { semantic: 1.2, episodic: 1, procedural: 0.8 };
	}
	return { semantic: 1, episodic: 1, procedural: 1 };
};

export const planQueryFast = (
	query: Pick<RecallQuery, "query" | "from" | "to" | "asOf" | "entities">,
	now = Date.now(),
): QueryPlan => {
	const temporal = parseTemporal(query.query, now);
	const intent = detectIntent(query.query);
	return {
		text: query.query,
		terms: tokenizeQuery(query.query),
		temporalFrom: query.from ?? temporal.from,
		temporalTo: query.to ?? temporal.to,
		asOf: query.asOf ?? null,
		typeWeights: typeWeightsFor(intent),
		entities: query.entities ? [...query.entities] : properNamesInQuery(query.query),
		intent,
	};
};

const cacheKey = (query: string): string => {
	let hash = 5381;
	for (let i = 0; i < query.length; i++) {
		hash = (hash * 33) ^ query.charCodeAt(i);
	}
	return `q${(hash >>> 0).toString(16)}:${query.length}`;
};

export const planQuery = (
	query: Pick<RecallQuery, "query" | "from" | "to" | "asOf" | "entities" | "plan">,
	now = Date.now(),
) =>
	Effect.gen(function* () {
		const fast = planQueryFast(query, now);
		if (query.plan !== "full") {
			return fast;
		}
		const repo = yield* MemoryRepo;
		const hash = cacheKey(`full:${query.query}`);
		const cached = yield* repo.getQueryPlan(hash, now);
		if (cached) {
			return cached;
		}
		const llm = yield* Llm;
		const planned = yield* llm
			.structured({
				job: "query",
				schema: QueryPlanSchema,
				schemaName: "query_plan",
				jsonSchema: queryPlanJsonSchema(),
				system:
					"Expand the user query into retrieval terms, entities, temporal bounds, and an intent. Keep typeWeights around 1.0.",
				user: query.query,
			})
			.pipe(Effect.orElseSucceed(() => fast));
		const merged: QueryPlan = {
			...fast,
			terms: planned.terms.length > 0 ? [...planned.terms] : fast.terms,
			entities: planned.entities.length > 0 ? [...planned.entities] : fast.entities,
			intent: planned.intent,
			typeWeights: planned.typeWeights,
			temporalFrom: planned.temporalFrom ?? fast.temporalFrom,
			temporalTo: planned.temporalTo ?? fast.temporalTo,
		};
		yield* repo.putQueryPlan(hash, merged, now + 3_600_000);
		return merged;
	});

export const freshness = (
	type: MemoryType,
	ageMs: number,
	halfLifeDays: Record<MemoryType, number>,
): number => {
	const halfLife = halfLifeDays[type];
	if (!Number.isFinite(halfLife) || halfLife <= 0) {
		return 1;
	}
	const ageDays = Math.max(0, ageMs / MS_DAY);
	return 0.5 ** (ageDays / halfLife);
};
