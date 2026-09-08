import {
	AddMemoryRequest,
	DEFAULT_LLM_PROVIDER,
	defaultLlmConfig,
	FALLBACK_LLM_PROVIDER,
	IngestRequest,
	MEMORY_KINDS,
	type MemoryKind,
	RecallQuery,
	SearchQuery,
} from "@yumeoi/domain";
import { Schema } from "effect";
import { authenticateRequest, unauthorized } from "../auth/api-key.ts";
import { listApiKeys, mintApiKey, revokeApiKey } from "../auth/api-keys.ts";
import { handleSpikes } from "./spikes.ts";

const json = (body: unknown, status = 200) =>
	Response.json(body, {
		status,
		headers: { "cache-control": "no-store" },
	});

const decodeBody = <A, I>(schema: Schema.Codec<A, I>, raw: unknown): A | null => {
	try {
		return Schema.decodeUnknownSync(schema)(raw);
	} catch {
		return null;
	}
};

const asKinds = (value: unknown): MemoryKind[] => {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter(
		(item): item is MemoryKind =>
			typeof item === "string" && (MEMORY_KINDS as readonly string[]).includes(item),
	);
};

const asStrings = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const ingestRequestFromUnknown = (raw: unknown): IngestRequest | null => {
	if (!raw || typeof raw !== "object") {
		return null;
	}
	const body = raw as Record<string, unknown>;
	if (typeof body.externalId !== "string" || typeof body.markdown !== "string") {
		return null;
	}
	const metadata =
		body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
			? body.metadata
			: undefined;
	return decodeBody(IngestRequest, {
		externalId: body.externalId,
		title: typeof body.title === "string" ? body.title : body.externalId,
		markdown: body.markdown,
		sourceId: typeof body.sourceId === "string" ? body.sourceId : "generic",
		sourceLabel: typeof body.sourceLabel === "string" ? body.sourceLabel : "Generic ingest",
		url: typeof body.url === "string" ? body.url : null,
		...(metadata ? { metadata } : {}),
	});
};

const searchQueryFromUnknown = (raw: unknown): SearchQuery | null => {
	if (!raw || typeof raw !== "object") {
		return null;
	}
	const body = raw as Record<string, unknown>;
	if (typeof body.query !== "string") {
		return null;
	}
	return decodeBody(SearchQuery, {
		query: body.query,
		sources: asStrings(body.sources),
		kinds: asKinds(body.kinds),
		since: typeof body.since === "number" ? body.since : null,
		limit: typeof body.limit === "number" ? body.limit : 20,
	});
};

const recallQueryFromUnknown = (raw: unknown): RecallQuery | null => {
	if (!raw || typeof raw !== "object") {
		return null;
	}
	const body = raw as Record<string, unknown>;
	if (typeof body.query !== "string") {
		return null;
	}
	return decodeBody(RecallQuery, {
		query: body.query,
		sources: asStrings(body.sources),
		kinds: asKinds(body.kinds),
		since: typeof body.since === "number" ? body.since : null,
		budgetTokens: typeof body.budgetTokens === "number" ? body.budgetTokens : 2000,
		rerank: typeof body.rerank === "boolean" ? body.rerank : true,
	});
};

const addMemoryFromUnknown = (raw: unknown): AddMemoryRequest | null => {
	if (!raw || typeof raw !== "object") {
		return null;
	}
	const body = raw as Record<string, unknown>;
	if (typeof body.text !== "string") {
		return null;
	}
	return decodeBody(AddMemoryRequest, {
		text: body.text,
		kind: asKinds([body.kind])[0] ?? "fact",
		confidence: typeof body.confidence === "number" ? body.confidence : 1,
		...(typeof body.sourceId === "string" ? { sourceId: body.sourceId } : {}),
	});
};

export async function handleApi(request: Request, env: Env): Promise<Response | null> {
	const url = new URL(request.url);

	if (url.pathname === "/api/health") {
		return json({
			ok: true,
			milestone: "m1",
			chatModel: defaultLlmConfig.chat,
			extractModel: defaultLlmConfig.extract,
			consolidateModel: defaultLlmConfig.consolidate,
			rerankModel: defaultLlmConfig.rerank,
			llm: {
				defaultProvider: DEFAULT_LLM_PROVIDER,
				fallbackProvider: FALLBACK_LLM_PROVIDER,
			},
		});
	}

	if (url.pathname.startsWith("/api/spikes/")) {
		return handleSpikes(request, env);
	}

	const needsAuth =
		url.pathname === "/ingest" ||
		url.pathname.startsWith("/api/search") ||
		url.pathname.startsWith("/api/recall") ||
		url.pathname.startsWith("/api/memories") ||
		url.pathname.startsWith("/api/documents") ||
		url.pathname.startsWith("/api/sources") ||
		url.pathname.startsWith("/api/keys");

	if (!needsAuth) {
		if (url.pathname.startsWith("/api/") || url.pathname === "/ingest") {
			return json({ error: "not found" }, 404);
		}
		return null;
	}

	const auth = await authenticateRequest(request, env);
	if (!auth) {
		return unauthorized();
	}

	const agent = env.MemoryAgent.getByName(auth.userId);

	if (url.pathname === "/ingest" && request.method === "POST") {
		const body = ingestRequestFromUnknown(await request.json().catch(() => null));
		if (!body) {
			return json({ error: "externalId and markdown are required" }, 400);
		}
		const result = await agent.startIngest(body);
		return json(result, result.unchanged ? 200 : 201);
	}

	if (url.pathname === "/api/search" && request.method === "POST") {
		const query = searchQueryFromUnknown(await request.json().catch(() => null));
		if (!query) {
			return json({ error: "query is required" }, 400);
		}
		const hits = await agent.search(query);
		return json({ memories: hits });
	}

	if (url.pathname === "/api/recall" && request.method === "POST") {
		const query = recallQueryFromUnknown(await request.json().catch(() => null));
		if (!query) {
			return json({ error: "query is required" }, 400);
		}
		const result = await agent.recall(query);
		return json(result);
	}

	if (url.pathname === "/api/memories" && request.method === "POST") {
		const body = addMemoryFromUnknown(await request.json().catch(() => null));
		if (!body) {
			return json({ error: "text is required" }, 400);
		}
		const memory = await agent.addMemory({
			...body,
			sourceId: body.sourceId ?? `agent:${auth.userId}`,
		});
		return json(memory, 201);
	}

	if (url.pathname.startsWith("/api/memories/") && request.method === "GET") {
		const id = url.pathname.slice("/api/memories/".length);
		try {
			return json(await agent.getMemory(id));
		} catch {
			return json({ error: "not found" }, 404);
		}
	}

	if (url.pathname.startsWith("/api/documents/") && request.method === "GET") {
		const id = url.pathname.slice("/api/documents/".length);
		try {
			return json(await agent.getDocument(id));
		} catch {
			return json({ error: "not found" }, 404);
		}
	}

	if (url.pathname === "/api/sources" && request.method === "GET") {
		return json({ sources: await agent.listSources() });
	}

	if (url.pathname === "/api/keys" && request.method === "GET") {
		try {
			return json({ keys: await listApiKeys(env, auth.userId) });
		} catch {
			return json({ error: "api keys unavailable" }, 503);
		}
	}

	if (url.pathname === "/api/keys" && request.method === "POST") {
		try {
			return json(await mintApiKey(env, auth.userId), 201);
		} catch {
			return json({ error: "api keys unavailable" }, 503);
		}
	}

	if (url.pathname.startsWith("/api/keys/") && request.method === "DELETE") {
		const id = url.pathname.slice("/api/keys/".length);
		try {
			const revoked = await revokeApiKey(env, auth.userId, id);
			if (!revoked) {
				return json({ error: "not found" }, 404);
			}
			return json({ ok: true, id });
		} catch {
			return json({ error: "api keys unavailable" }, 503);
		}
	}

	if (url.pathname.startsWith("/api/") || url.pathname === "/ingest") {
		return json({ error: "not found" }, 404);
	}

	return null;
}
