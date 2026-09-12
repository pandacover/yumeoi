import { InvalidRequest, NotFound, RateLimited, SchemaViolation, Unauthorized } from "./errors.ts";
import type { ToolError, ToolErrorCode } from "./schema.ts";

export type FieldIssue = {
	readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
	readonly message: string;
	readonly code?: string;
};

const pathKey = (segment: PropertyKey | { readonly key: PropertyKey }): string =>
	typeof segment === "object" && segment !== null && "key" in segment
		? String(segment.key)
		: String(segment);

const issuePath = (issue: FieldIssue): string =>
	(issue.path ?? []).map(pathKey).filter(Boolean).join(".");

const firstLine = (text: string): string => {
	const line = text.split("\n")[0]?.trim() ?? "";
	return line.length > 400 ? `${line.slice(0, 397)}...` : line;
};

const looksLikeStack = (text: string): boolean =>
	/\n\s*at \S+/.test(text) || /(?:^|\s)at \S+ \([^)]+:\d+:\d+\)/.test(text);

const tagged = (value: unknown): { readonly _tag: string } | null => {
	if (value && typeof value === "object" && "_tag" in value) {
		const tag = (value as { _tag: unknown })._tag;
		if (typeof tag === "string" && tag.length > 0) {
			return { _tag: tag };
		}
	}
	return null;
};

const payloadMessage = (value: unknown): string => {
	if (value && typeof value === "object" && "message" in value) {
		const message = (value as { message: unknown }).message;
		if (typeof message === "string" && message.trim()) {
			return message.trim();
		}
	}
	if (value instanceof Error && value.message.trim()) {
		return value.message.trim();
	}
	return "";
};

export const TOOL_ERROR_HINTS = {
	unauthorized:
		"MCP access token is missing, expired, or the grant was revoked. Reconnect OAuth in the host so it can refresh. Horizon → Agents lists connected clients.",
	notFound: (entity: string, id: string) => {
		const label = id ? `${entity} ${id}` : entity;
		return `${label} was not found. Use a memory id from a recall footer (\`ids: m_…=[1]\`) or search_memories; document ids come from get_memory provenance.`;
	},
	rememberPayload:
		'remember needs text or items[]. Examples: {"text":"Luv prefers oat milk.","mode":"verbatim"} or {"items":[{"text":"Luv prefers oat milk.","clientRef":"note-1"}]}.',
	forgetTarget:
		'forget needs id or query. Pass a memory id from a recall footer (`ids: m_…=[1]`), or {"query":"oat milk","confirm":true}.',
	forgetConfirm:
		"This memory is extracted. Pass confirm=true to forget it (agent/user/chat origin can omit confirm when forgetting by id).",
	forgetQueryConfirm:
		'Forgetting by query requires confirm=true. Example: {"query":"oat milk","confirm":true}.',
	feedbackSignal:
		'signal must be the integer 1 (useful) or -1 (wrong), not a string, 0, or a label like "useful".',
	epochMs: (field: string) =>
		`${field} is a Unix timestamp in milliseconds (e.g. Date.now() or 1700000000000), not an ISO-8601 string.`,
	isoDatetime: (field: string) =>
		`${field} must be an ISO-8601 datetime string (e.g. 2026-03-15T00:00:00.000Z) or null.`,
	entityTarget: 'get_entity needs name or id. Example: {"name":"Aurora"} or {"id":"e_…"}.',
	memoryId:
		"id is required. Copy a memory id from a recall footer (`ids: m_…=[1]`) or from search_memories.",
	documentId: "id is required. Use a document id from get_memory provenance or a recall citation.",
	queryRequired:
		'query is required. Pass a natural-language question or topic, e.g. {"query":"What does Luv prefer?"}.',
	rateLimited: (provider: string, retryAfterMs?: number) =>
		retryAfterMs
			? `The ${provider} provider rate-limited this call. Wait ${retryAfterMs}ms and retry.`
			: `The ${provider} provider rate-limited this call. Wait and retry.`,
	scopeRequired:
		"This tool needs a memories:write (or memories:read) OAuth scope. Reconnect the MCP client and approve the missing scope.",
	conflict: "This write conflicted with a concurrent update. Recall the latest memory and retry.",
	schema:
		"Input did not match the tool schema. Check required fields, enums, and timestamp units (from/to/asOf/since are millisecond epochs; eventAt/validFrom/validTo are ISO-8601).",
} as const;

const EPOCH_FIELDS = new Set(["from", "to", "asOf", "since"]);
const ISO_FIELDS = new Set(["eventAt", "validFrom", "validTo"]);

const leafField = (path: string): string => {
	const parts = path.split(".").filter(Boolean);
	return parts[parts.length - 1] ?? path;
};

export const hintForFieldIssues = (issues: ReadonlyArray<FieldIssue>): string => {
	if (issues.length === 0) {
		return TOOL_ERROR_HINTS.schema;
	}
	const hints: string[] = [];
	for (const issue of issues) {
		const path = issuePath(issue);
		const field = leafField(path);
		const message = issue.message.toLowerCase();
		if (/forget needs id or query/i.test(issue.message)) {
			hints.push(TOOL_ERROR_HINTS.forgetTarget);
			continue;
		}
		if (/forgetting by query requires confirm=true/i.test(issue.message)) {
			hints.push(TOOL_ERROR_HINTS.forgetQueryConfirm);
			continue;
		}
		if (/get_entity needs name or id/i.test(issue.message)) {
			hints.push(TOOL_ERROR_HINTS.entityTarget);
			continue;
		}
		if (/remember needs text or items/i.test(issue.message)) {
			hints.push(TOOL_ERROR_HINTS.rememberPayload);
			continue;
		}
		if (field === "signal" || /signal/.test(path)) {
			hints.push(TOOL_ERROR_HINTS.feedbackSignal);
			continue;
		}
		if (EPOCH_FIELDS.has(field)) {
			hints.push(TOOL_ERROR_HINTS.epochMs(field));
			continue;
		}
		if (ISO_FIELDS.has(field) && /iso|datetime|date|string|invalid/i.test(issue.message)) {
			hints.push(TOOL_ERROR_HINTS.isoDatetime(field));
			continue;
		}
		if (
			field === "confirm" ||
			(/confirm=true/.test(issue.message) && /extracted/i.test(issue.message))
		) {
			hints.push(TOOL_ERROR_HINTS.forgetConfirm);
			continue;
		}
		if (
			(field === "text" || field === "items") &&
			/required|invalid_type|undefined/.test(message)
		) {
			hints.push(TOOL_ERROR_HINTS.rememberPayload);
			continue;
		}
		if (field === "query" && /required|invalid_type|undefined/.test(message)) {
			hints.push(TOOL_ERROR_HINTS.queryRequired);
			continue;
		}
		if (field === "id" && /required|invalid_type|undefined/.test(message)) {
			hints.push(TOOL_ERROR_HINTS.memoryId);
			continue;
		}
		if (field === "name" || (field === "id" && /name or id/i.test(issue.message))) {
			hints.push(TOOL_ERROR_HINTS.entityTarget);
			continue;
		}
		const location = path ? `${path}: ${issue.message}` : issue.message;
		hints.push(`Fix ${location}. ${TOOL_ERROR_HINTS.schema}`);
	}
	return [...new Set(hints)].join(" ");
};

const mapTagged = (error: { readonly _tag: string }, source: unknown): ToolError | null => {
	switch (error._tag) {
		case "Unauthorized":
			return { error: "unauthorized", hint: TOOL_ERROR_HINTS.unauthorized };
		case "NotFound": {
			const entity =
				source && typeof source === "object" && "entity" in source
					? String((source as { entity: unknown }).entity)
					: "record";
			const id =
				source && typeof source === "object" && "id" in source
					? String((source as { id: unknown }).id)
					: "";
			return { error: "not_found", hint: TOOL_ERROR_HINTS.notFound(entity, id) };
		}
		case "RateLimited": {
			const provider =
				source && typeof source === "object" && "provider" in source
					? String((source as { provider: unknown }).provider)
					: "upstream";
			const retryAfterMs =
				source && typeof source === "object" && "retryAfterMs" in source
					? Number((source as { retryAfterMs: unknown }).retryAfterMs)
					: undefined;
			return {
				error: "rate_limited",
				hint: TOOL_ERROR_HINTS.rateLimited(
					provider,
					Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
				),
			};
		}
		case "InvalidRequest":
		case "SchemaViolation": {
			const message = payloadMessage(source);
			if (/confirm=true/.test(message) && /extracted/i.test(message)) {
				return { error: "invalid_input", hint: `${message}. ${TOOL_ERROR_HINTS.forgetConfirm}` };
			}
			if (/query plus confirm=true|query.*confirm/i.test(message)) {
				return { error: "invalid_input", hint: TOOL_ERROR_HINTS.forgetQueryConfirm };
			}
			if (/id, or query/i.test(message)) {
				return { error: "invalid_input", hint: TOOL_ERROR_HINTS.forgetTarget };
			}
			if (/text or items/i.test(message)) {
				return { error: "invalid_input", hint: TOOL_ERROR_HINTS.rememberPayload };
			}
			if (/signal/i.test(message)) {
				return { error: "invalid_input", hint: TOOL_ERROR_HINTS.feedbackSignal };
			}
			return {
				error: "invalid_input",
				hint: message
					? `${firstLine(message)}. ${TOOL_ERROR_HINTS.schema}`
					: TOOL_ERROR_HINTS.schema,
			};
		}
		default:
			return null;
	}
};

const mapMessage = (message: string): ToolError => {
	const text = firstLine(message);
	if (/unauthorized|expired token|invalid_token|no user/i.test(text)) {
		return { error: "unauthorized", hint: TOOL_ERROR_HINTS.unauthorized };
	}
	if (/not found|notfound/i.test(text)) {
		const idMatch = text.match(/\b(m_[0-9a-hjkmnp-tv-z]+|doc-[^\s]+|e_[^\s]+)\b/i);
		const entity = /document/i.test(text) ? "document" : /entity/i.test(text) ? "entity" : "memory";
		return { error: "not_found", hint: TOOL_ERROR_HINTS.notFound(entity, idMatch?.[1] ?? "") };
	}
	if (/scope/i.test(text) && /required|missing|insufficient/i.test(text)) {
		return { error: "scope_required", hint: TOOL_ERROR_HINTS.scopeRequired };
	}
	if (/rate.?limit/i.test(text)) {
		return { error: "rate_limited", hint: TOOL_ERROR_HINTS.rateLimited("upstream") };
	}
	if (/conflict/i.test(text)) {
		return { error: "conflict", hint: TOOL_ERROR_HINTS.conflict };
	}
	if (/confirm=true/.test(text) && /extracted/i.test(text)) {
		return { error: "invalid_input", hint: `${text}. ${TOOL_ERROR_HINTS.forgetConfirm}` };
	}
	if (/query plus confirm=true|forget requires id/i.test(text)) {
		return {
			error: "invalid_input",
			hint: /query/.test(text)
				? TOOL_ERROR_HINTS.forgetQueryConfirm
				: TOOL_ERROR_HINTS.forgetTarget,
		};
	}
	if (/text or items/i.test(text)) {
		return { error: "invalid_input", hint: TOOL_ERROR_HINTS.rememberPayload };
	}
	if (/\bsignal\b/i.test(text)) {
		return { error: "invalid_input", hint: TOOL_ERROR_HINTS.feedbackSignal };
	}
	if (/input validation error|invalid arguments for tool/i.test(text)) {
		return {
			error: "invalid_input",
			hint: `${text} ${TOOL_ERROR_HINTS.schema}`,
		};
	}
	for (const field of EPOCH_FIELDS) {
		if (new RegExp(`\\b${field}\\b`, "i").test(text) && /iso|string|number/i.test(text)) {
			return { error: "invalid_input", hint: TOOL_ERROR_HINTS.epochMs(field) };
		}
	}
	return {
		error: "invalid_input",
		hint: looksLikeStack(message) ? TOOL_ERROR_HINTS.schema : `${text}. ${TOOL_ERROR_HINTS.schema}`,
	};
};

export const mapToolFailure = (caught: unknown): ToolError => {
	if (caught instanceof Unauthorized) {
		return { error: "unauthorized", hint: TOOL_ERROR_HINTS.unauthorized };
	}
	if (caught instanceof NotFound) {
		return { error: "not_found", hint: TOOL_ERROR_HINTS.notFound(caught.entity, caught.id) };
	}
	if (caught instanceof RateLimited) {
		return {
			error: "rate_limited",
			hint: TOOL_ERROR_HINTS.rateLimited(caught.provider, caught.retryAfterMs),
		};
	}
	if (caught instanceof InvalidRequest || caught instanceof SchemaViolation) {
		return (
			mapTagged({ _tag: caught._tag }, caught) ?? {
				error: "invalid_input",
				hint: TOOL_ERROR_HINTS.schema,
			}
		);
	}
	const tag = tagged(caught);
	if (tag) {
		const mapped = mapTagged(tag, caught);
		if (mapped) {
			return mapped;
		}
	}
	if (caught && typeof caught === "object" && "issues" in caught && Array.isArray(caught.issues)) {
		return { error: "invalid_input", hint: hintForFieldIssues(caught.issues as FieldIssue[]) };
	}
	if (caught instanceof Error) {
		return mapMessage(caught.message);
	}
	if (typeof caught === "string") {
		return mapMessage(caught);
	}
	return { error: "invalid_input", hint: TOOL_ERROR_HINTS.schema };
};

export const isToolErrorCode = (value: string): value is ToolErrorCode =>
	value === "not_found" ||
	value === "invalid_input" ||
	value === "unauthorized" ||
	value === "scope_required" ||
	value === "rate_limited" ||
	value === "conflict";
