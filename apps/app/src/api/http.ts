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
	type SourceKind,
} from "@yumeoi/domain";
import { Schema } from "effect";
import { authenticateRequest, unauthorized } from "../auth/api-key.ts";
import { listApiKeys, mintApiKey, revokeApiKey } from "../auth/api-keys.ts";
import { listConnectedMcpClients, revokeConnectedMcpClient } from "../auth/mcp-clients.ts";
import { MCP_SCOPES } from "../auth/scopes.ts";
import {
	appUserId,
	connectFixtureSource,
	disconnectSource,
	finishNotionCallback,
	isFixtureConnect,
	startNotionAuthorize,
	syncSource,
} from "./sources.ts";
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

const SOURCE_KINDS = ["notion", "gmail", "obsidian", "generic", "agent"] as const;

const asSourceKind = (value: unknown): SourceKind | undefined =>
	typeof value === "string" && (SOURCE_KINDS as readonly string[]).includes(value)
		? (value as SourceKind)
		: undefined;

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
		...(asSourceKind(body.sourceKind) ? { sourceKind: asSourceKind(body.sourceKind) } : {}),
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
			milestone: "m4",
			chat: {
				model: defaultLlmConfig.chat,
				resumable: true,
				tools: ["recall", "get_document"],
			},
			mcp: {
				oauth: true,
				authorize: "/authorize",
				token: "/token",
				register: "/register",
				scopes: [...MCP_SCOPES],
				apiKey: true,
			},
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

	const pathname = url.pathname.replace(/\/+$/, "") || "/";
	const isPublicNotionOAuth =
		pathname === "/api/sources/notion/authorize" || pathname === "/api/sources/notion/callback";

	if (pathname === "/api/sources/notion/authorize" && request.method === "GET") {
		try {
			const location = await startNotionAuthorize(env, request, appUserId(env));
			return Response.redirect(location, 302);
		} catch (error) {
			return json({ error: error instanceof Error ? error.message : String(error) }, 503);
		}
	}

	if (pathname === "/api/sources/notion/callback" && request.method === "GET") {
		const code = url.searchParams.get("code");
		const state = url.searchParams.get("state");
		if (!code || !state) {
			return json({ error: "code and state are required" }, 400);
		}
		try {
			const source = await finishNotionCallback(env, request, code, state);
			await syncSource(env, source.id);
			return Response.redirect(new URL("/sources?connected=1", request.url), 302);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const invalidClient = /invalid_client/i.test(message);
			return json(
				{
					error: invalidClient ? "invalid_client" : message,
					message: invalidClient
						? "Notion rejected the OAuth client ID or secret. Copy both from the same public connection Configuration tab, not an internal integration token."
						: message,
				},
				invalidClient ? 401 : 400,
			);
		}
	}

	const needsAuth =
		url.pathname === "/ingest" ||
		url.pathname.startsWith("/api/search") ||
		url.pathname.startsWith("/api/recall") ||
		url.pathname.startsWith("/api/memories") ||
		url.pathname.startsWith("/api/documents") ||
		(url.pathname.startsWith("/api/sources") && !isPublicNotionOAuth) ||
		url.pathname.startsWith("/api/keys") ||
		url.pathname.startsWith("/api/grants");

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

	if (url.pathname === "/api/memories" && request.method === "GET") {
		const queryText = url.searchParams.get("query");
		const hits = await agent.browseMemories({
			...(queryText ? { query: queryText } : {}),
			sources: asStrings(url.searchParams.getAll("sources")),
			kinds: asKinds(url.searchParams.getAll("kinds")),
			limit: Number(url.searchParams.get("limit") ?? 40) || 40,
		});
		return json({ memories: hits });
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

	if (url.pathname === "/api/sources" && request.method === "POST") {
		const body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
		const kind = body.kind === "notion" ? "notion" : null;
		if (!kind) {
			return json({ error: "kind must be notion" }, 400);
		}
		if (isFixtureConnect(body) || body.mode === "fixture") {
			const source = await connectFixtureSource(env, auth.userId);
			return json({ source }, 201);
		}
		try {
			const authorizeUrl = await startNotionAuthorize(env, request, auth.userId);
			return json({ authorizeUrl });
		} catch (error) {
			return json({ error: error instanceof Error ? error.message : String(error) }, 503);
		}
	}

	const sourceSync = url.pathname.match(/^\/api\/sources\/([^/]+)\/sync$/);
	if (sourceSync && request.method === "POST") {
		const sourceId = decodeURIComponent(sourceSync[1] ?? "");
		return json(await syncSource(env, sourceId));
	}

	const sourceIdMatch = url.pathname.match(/^\/api\/sources\/([^/]+)$/);
	if (sourceIdMatch && request.method === "DELETE") {
		const sourceId = decodeURIComponent(sourceIdMatch[1] ?? "");
		return json(await disconnectSource(env, sourceId));
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

	if (url.pathname === "/api/grants" && request.method === "GET") {
		try {
			return json({ grants: await listConnectedMcpClients(env, auth.userId) });
		} catch {
			return json({ error: "grants unavailable" }, 503);
		}
	}

	if (url.pathname.startsWith("/api/grants/") && request.method === "DELETE") {
		const id = url.pathname.slice("/api/grants/".length);
		try {
			const revoked = await revokeConnectedMcpClient(env, auth.userId, id);
			if (!revoked) {
				return json({ error: "not found" }, 404);
			}
			return json({ ok: true, id });
		} catch {
			return json({ error: "grants unavailable" }, 503);
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
