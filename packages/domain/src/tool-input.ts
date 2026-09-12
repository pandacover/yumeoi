import {
	defaultTypeForKind,
	MEMORY_KINDS,
	MEMORY_TYPES,
	type MemoryKind,
	type MemoryType,
} from "./schema.ts";

const KIND_SET = new Set<string>(MEMORY_KINDS);
const TYPE_SET = new Set<string>(MEMORY_TYPES);
const EPOCH_FIELDS = new Set(["from", "to", "asOf", "since"]);
const NUMBER_FIELDS = new Set(["importance", "confidence", "budgetTokens", "limit", "hops"]);
const BOOLEAN_FIELDS = new Set(["confirm", "dedupe", "includeDormant"]);
const STRING_ENUMS: Record<string, ReadonlySet<string>> = {
	mode: new Set(["extract", "verbatim"]),
	format: new Set(["markdown", "json"]),
	plan: new Set(["fast", "full"]),
	rerankMode: new Set(["none", "cross", "llm"]),
};
const ARRAY_ENUMS: Record<string, ReadonlySet<string>> = {
	kinds: KIND_SET,
	types: TYPE_SET,
	include: new Set(["memories", "evidence", "entities", "conflicts"]),
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const blank = (value: unknown): boolean =>
	value === undefined || value === null || (typeof value === "string" && value.trim() === "");

const nonEmptyString = (value: unknown): string | undefined => {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
};

export const coerceEpochMs = (value: unknown): unknown => {
	if (value === null) {
		return null;
	}
	if (blank(value)) {
		return undefined;
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
			const numeric = Number(trimmed);
			if (Number.isFinite(numeric)) {
				return numeric;
			}
		}
		const ms = Date.parse(trimmed);
		if (!Number.isNaN(ms)) {
			return ms;
		}
	}
	return value;
};

export const coerceSignal = (value: unknown): unknown => {
	if (value === 1 || value === -1) {
		return value;
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed === "1" || trimmed === "+1") {
			return 1;
		}
		if (trimmed === "-1") {
			return -1;
		}
	}
	if (typeof value === "number" && Object.is(value, 1)) {
		return 1;
	}
	if (typeof value === "number" && Object.is(value, -1)) {
		return -1;
	}
	return value;
};

const coerceNumber = (value: unknown): unknown => {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed === "") {
			return undefined;
		}
		const numeric = Number(trimmed);
		if (Number.isFinite(numeric) && trimmed !== "") {
			return numeric;
		}
	}
	if (blank(value)) {
		return undefined;
	}
	return value;
};

const coerceBoolean = (value: unknown): unknown => {
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "string") {
		const trimmed = value.trim().toLowerCase();
		if (trimmed === "true" || trimmed === "1") {
			return true;
		}
		if (trimmed === "false" || trimmed === "0") {
			return false;
		}
	}
	if (value === 1) {
		return true;
	}
	if (value === 0) {
		return false;
	}
	return value;
};

const keepEnum = (value: unknown, allowed: ReadonlySet<string>): string | undefined =>
	typeof value === "string" && allowed.has(value) ? value : undefined;

const filterEnumArray = (value: unknown, allowed: ReadonlySet<string>): string[] | undefined => {
	const source = typeof value === "string" ? [value] : Array.isArray(value) ? value : null;
	if (!source) {
		return undefined;
	}
	const next = source.filter(
		(item): item is string => typeof item === "string" && allowed.has(item),
	);
	return next.length > 0 ? next : undefined;
};

const dropMismatchedKindType = (out: Record<string, unknown>): void => {
	const kind = out.kind;
	const type = out.type;
	if (typeof kind !== "string" || typeof type !== "string") {
		return;
	}
	if (!KIND_SET.has(kind) || !TYPE_SET.has(type)) {
		return;
	}
	if (defaultTypeForKind(kind as MemoryKind) !== (type as MemoryType)) {
		delete out.kind;
		delete out.type;
	}
};

type ObjectRole = "root" | "item" | "other";

const preprocessObject = (
	value: Record<string, unknown>,
	role: ObjectRole,
): Record<string, unknown> => {
	const out: Record<string, unknown> = {};
	for (const [key, raw] of Object.entries(value)) {
		if (typeof raw === "string" && raw.trim() === "") {
			continue;
		}
		if (raw === undefined) {
			continue;
		}
		if (EPOCH_FIELDS.has(key)) {
			const coerced = coerceEpochMs(raw);
			if (coerced !== undefined) {
				out[key] = coerced;
			}
			continue;
		}
		if (key === "signal") {
			out[key] = coerceSignal(raw);
			continue;
		}
		if (NUMBER_FIELDS.has(key)) {
			const coerced = coerceNumber(raw);
			if (coerced !== undefined) {
				out[key] = coerced;
			}
			continue;
		}
		if (BOOLEAN_FIELDS.has(key)) {
			const coerced = coerceBoolean(raw);
			if (coerced !== undefined && coerced !== "") {
				out[key] = coerced;
			}
			continue;
		}
		if (key === "kind" && role !== "other") {
			const kept = keepEnum(raw, KIND_SET);
			if (kept) {
				out[key] = kept;
			}
			continue;
		}
		if (key === "type" && role !== "other") {
			const kept = keepEnum(raw, TYPE_SET);
			if (kept) {
				out[key] = kept;
			}
			continue;
		}
		if (key in STRING_ENUMS) {
			const kept = keepEnum(raw, STRING_ENUMS[key] ?? new Set());
			if (kept) {
				out[key] = kept;
			}
			continue;
		}
		if (key in ARRAY_ENUMS) {
			const kept = filterEnumArray(raw, ARRAY_ENUMS[key] ?? new Set());
			if (kept) {
				out[key] = kept;
			}
			continue;
		}
		if (key === "items") {
			const source = isRecord(raw) ? [raw] : Array.isArray(raw) ? raw : [];
			const items = source
				.filter(isRecord)
				.map((item) => preprocessObject(item, "item"))
				.filter((item) => typeof item.text === "string" && item.text.trim().length > 0);
			if (items.length > 0) {
				out[key] = items;
			}
			continue;
		}
		if (key === "entities" && Array.isArray(raw)) {
			out[key] = raw.map((entity) =>
				isRecord(entity) ? preprocessObject(entity, "other") : entity,
			);
			continue;
		}
		out[key] = raw;
	}
	if (role !== "other") {
		dropMismatchedKindType(out);
	}
	return out;
};

const unwrapJsonString = (raw: unknown): unknown => {
	if (typeof raw !== "string") {
		return raw;
	}
	const trimmed = raw.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
		return raw;
	}
	try {
		return JSON.parse(trimmed) as unknown;
	} catch {
		return raw;
	}
};

/** Coerce common agent mistakes before Zod/Effect validation. Idempotent. */
export const preprocessToolInput = (raw: unknown): unknown => {
	const unwrapped = unwrapJsonString(raw ?? {});
	if (!isRecord(unwrapped)) {
		return unwrapped ?? {};
	}
	return preprocessObject(unwrapped, "root");
};

const omitUndefined = (value: Record<string, unknown>): Record<string, unknown> =>
	Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));

const salvageItems = (value: unknown): Array<Record<string, unknown>> | undefined => {
	const source = isRecord(value) ? [value] : Array.isArray(value) ? value : [];
	const items = source.filter(isRecord).flatMap((item) => {
		const text = nonEmptyString(item.text);
		if (!text) {
			return [];
		}
		const clientRef = nonEmptyString(item.clientRef);
		return [omitUndefined({ text, clientRef })];
	});
	return items.length > 0 ? items : undefined;
};

export const TOOL_RETRY_PLACEHOLDERS = {
	remember: { text: "...", mode: "verbatim" },
	recall: { query: "..." },
	search_memories: { query: "..." },
	feedback: { id: "m_…", signal: 1 as const },
	forget: { id: "m_…" },
	update_memory: { id: "m_…" },
	get_memory: { id: "m_…" },
	get_document: { id: "doc-…" },
	get_entity: { name: "..." },
	timeline: { about: "..." },
	changes_since: { since: 1_700_000_000_000 },
	list_sources: {},
	recall_context: { query: "..." },
	add_memory: { text: "..." },
} as const;

export type ToolErrorContext = {
	readonly error?: string;
	readonly hint?: string;
};

/** Minimal valid next-call args. Copy-paste this object into the same tool. */
export const retryWithForTool = (
	tool: string,
	input: unknown,
	context: ToolErrorContext = {},
): Record<string, unknown> => {
	const raw = isRecord(input) ? input : {};
	const hint = context.hint ?? "";
	switch (tool) {
		case "remember":
		case "add_memory": {
			const text = nonEmptyString(raw.text);
			const items = salvageItems(raw.items);
			if (text) {
				return {
					text,
					mode: raw.mode === "extract" ? "extract" : "verbatim",
				};
			}
			if (items) {
				return { items, mode: "verbatim" };
			}
			return { ...TOOL_RETRY_PLACEHOLDERS.remember };
		}
		case "recall":
		case "recall_context":
		case "search_memories":
			return { query: nonEmptyString(raw.query) ?? "..." };
		case "feedback": {
			const id = nonEmptyString(raw.id) ?? "m_…";
			const note = nonEmptyString(raw.note);
			const query = nonEmptyString(raw.query);
			const signal = coerceSignal(raw.signal);
			const nextSignal = signal === 1 || signal === -1 ? signal : note || query ? -1 : 1;
			return omitUndefined({ id, signal: nextSignal, note, query });
		}
		case "forget": {
			const id = nonEmptyString(raw.id);
			const query = nonEmptyString(raw.query);
			const needsConfirm = /extracted|confirm=true/i.test(hint) || Boolean(query);
			if (id) {
				return needsConfirm ? { id, confirm: true } : { id };
			}
			if (query) {
				return { query, confirm: true };
			}
			return { ...TOOL_RETRY_PLACEHOLDERS.forget };
		}
		case "update_memory": {
			const id = nonEmptyString(raw.id) ?? "m_…";
			const text = nonEmptyString(raw.text);
			const kind = keepEnum(raw.kind, KIND_SET);
			const importance = coerceNumber(raw.importance);
			const validTo = nonEmptyString(raw.validTo) ?? (raw.validTo === null ? null : undefined);
			const eventAt = nonEmptyString(raw.eventAt) ?? (raw.eventAt === null ? null : undefined);
			return omitUndefined({
				id,
				text,
				kind,
				importance: typeof importance === "number" ? importance : undefined,
				validTo,
				eventAt,
			});
		}
		case "get_memory":
			return { id: nonEmptyString(raw.id) ?? "m_…" };
		case "get_document":
			return { id: nonEmptyString(raw.id) ?? "doc-…" };
		case "get_entity": {
			const name = nonEmptyString(raw.name);
			const id = nonEmptyString(raw.id);
			if (name) {
				return omitUndefined({ name, hops: coerceNumber(raw.hops) });
			}
			if (id) {
				return omitUndefined({ id, hops: coerceNumber(raw.hops) });
			}
			return { ...TOOL_RETRY_PLACEHOLDERS.get_entity };
		}
		case "timeline":
			return omitUndefined({
				about: nonEmptyString(raw.about) ?? "...",
				from: typeof raw.from === "number" ? raw.from : undefined,
				to: typeof raw.to === "number" ? raw.to : undefined,
				limit: typeof coerceNumber(raw.limit) === "number" ? coerceNumber(raw.limit) : undefined,
			});
		case "changes_since": {
			const since = coerceEpochMs(raw.since);
			return {
				since: typeof since === "number" ? since : TOOL_RETRY_PLACEHOLDERS.changes_since.since,
			};
		}
		case "list_sources":
			return {};
		default:
			return isRecord(input) ? { ...input } : {};
	}
};

const prettyTool = (tool: string): string => {
	const label = tool.replaceAll("_", " ");
	return label.charAt(0).toUpperCase() + label.slice(1);
};

const firstSentence = (hint: string): string => {
	const withoutExamples = hint.replace(/\s+Examples?:[\s\S]*$/i, "").trim();
	const sentence = withoutExamples.split(/(?<=\.)\s+/)[0]?.trim() ?? withoutExamples;
	return sentence.replace(/\.$/, "");
};

export const leadForToolError = (tool: string, error: string, hint: string): string => {
	const label = prettyTool(tool);
	if (error === "unauthorized") {
		return `${label} failed: reconnect OAuth in the host.`;
	}
	if (error === "scope_required") {
		return `${label} failed: missing OAuth scope. Reconnect and approve.`;
	}
	if (error === "conflict") {
		return `${label} failed: concurrent update. Recall the latest memory and retry.`;
	}
	if (error === "unavailable") {
		return `${label} failed: ${firstSentence(hint) || "upstream provider unavailable"}.`;
	}
	if (error === "schema_violation") {
		return `${label} failed: server classify output did not match the memory schema.`;
	}
	if (tool === "remember" && /text or items/i.test(hint)) {
		return "Remember failed: need text or items[].";
	}
	if (tool === "feedback" && /signal/i.test(hint)) {
		return "Feedback failed: signal must be 1 or -1.";
	}
	if (tool === "forget" && /id or query/i.test(hint)) {
		return "Forget failed: need id or query.";
	}
	const issue = firstSentence(hint);
	if (!issue) {
		return `${label} failed.`;
	}
	const stripped = issue.replace(
		new RegExp(`^(${tool}|${tool.replaceAll("_", " ")})\\s+`, "i"),
		"",
	);
	return `${label} failed: ${stripped}.`;
};

export const formatToolErrorText = (args: {
	readonly tool: string;
	readonly error: string;
	readonly hint: string;
	readonly retry_with?: Record<string, unknown>;
}): string => {
	const lead = leadForToolError(args.tool, args.error, args.hint);
	const payload = JSON.stringify({
		error: args.error,
		hint: args.hint,
		...(args.retry_with ? { retry_with: args.retry_with } : {}),
	});
	if (args.retry_with) {
		return `${lead}\nretry_with: ${JSON.stringify(args.retry_with)}\n${payload}`;
	}
	return `${lead}\n${payload}`;
};

export const parseToolErrorText = (
	text: string,
): {
	lead: string;
	error: string;
	hint: string;
	retry_with: Record<string, unknown>;
} => {
	const lines = text.trim().split("\n");
	const lead = lines[0] ?? "";
	const jsonLine = [...lines].reverse().find((line) => line.trim().startsWith("{")) ?? "{}";
	const parsed = JSON.parse(jsonLine) as {
		error?: string;
		hint?: string;
		retry_with?: Record<string, unknown>;
	};
	return {
		lead,
		error: parsed.error ?? "invalid_input",
		hint: parsed.hint ?? "",
		retry_with: parsed.retry_with ?? {},
	};
};
