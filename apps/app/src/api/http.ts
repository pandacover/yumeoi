import {
	AddMemoryRequest,
	ChangesSinceToolInput,
	DEFAULT_LLM_PROVIDER,
	defaultLlmConfig,
	FALLBACK_LLM_PROVIDER,
	FeedbackToolInput,
	ForgetToolInput,
	GetEntityToolInput,
	IngestRequest,
	MEMORY_KINDS,
	MEMORY_TYPES,
	type MemoryKind,
	type MemoryType,
	RecallQuery,
	RememberToolInput,
	SearchQuery,
	type SourceKind,
	TimelineToolInput,
	UpdateMemoryToolInput,
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
		since:
			typeof body.since === "number"
				? body.since
				: typeof body.from === "number"
					? body.from
					: null,
		limit: typeof body.limit === "number" ? body.limit : 20,
		...(asTypes(body.types).length > 0 ? { types: asTypes(body.types) } : {}),
		...(typeof body.from === "number" ? { from: body.from } : {}),
		...(typeof body.to === "number" ? { to: body.to } : {}),
		...(typeof body.asOf === "number" ? { asOf: body.asOf } : {}),
		...(asStrings(body.entities).length > 0 ? { entities: asStrings(body.entities) } : {}),
		...(typeof body.includeDormant === "boolean" ? { includeDormant: body.includeDormant } : {}),
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
		since:
			typeof body.since === "number"
				? body.since
				: typeof body.from === "number"
					? body.from
					: null,
		budgetTokens: typeof body.budgetTokens === "number" ? body.budgetTokens : 1500,
		rerank: typeof body.rerank === "boolean" ? body.rerank : true,
		...(asTypes(body.types).length > 0 ? { types: asTypes(body.types) } : {}),
		...(typeof body.from === "number" ? { from: body.from } : {}),
		...(typeof body.to === "number" ? { to: body.to } : {}),
		...(typeof body.asOf === "number" ? { asOf: body.asOf } : {}),
		...(asStrings(body.entities).length > 0 ? { entities: asStrings(body.entities) } : {}),
		...(Array.isArray(body.include) ? { include: body.include } : {}),
		...(body.format === "markdown" || body.format === "json" ? { format: body.format } : {}),
		...(body.plan === "fast" || body.plan === "full" ? { plan: body.plan } : {}),
		...(body.rerankMode === "none" || body.rerankMode === "cross" || body.rerankMode === "llm"
			? { rerankMode: body.rerankMode }
			: {}),
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
	const type = asType(body.type);
	return decodeBody(AddMemoryRequest, {
		text: body.text,
		kind: asKinds([body.kind])[0] ?? "fact",
		confidence: typeof body.confidence === "number" ? body.confidence : 1,
		...(typeof body.sourceId === "string" ? { sourceId: body.sourceId } : {}),
		...(type ? { type } : {}),
		...(typeof body.clientRef === "string" ? { clientRef: body.clientRef } : {}),
	});
};

const asType = (value: unknown): MemoryType | undefined =>
	typeof value === "string" && (MEMORY_TYPES as readonly string[]).includes(value)
		? (value as MemoryType)
		: undefined;

const asTypes = (value: unknown): MemoryType[] => {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap((item) => {
		const type = asType(item);
		return type ? [type] : [];
	});
};

export async function handleApi(request: Request, env: Env): Promise<Response | null> {
	const url = new URL(request.url);

	if (url.pathname === "/api/health") {
		const userId = appUserId(env);
		const stats = await env.MemoryAgent.getByName(userId)
			.memoryStats()
			.catch(() => null);
		return json({
			ok: true,
			milestone: "m4",
			phase: "p6",
			memory: stats,
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
			classifyModel: defaultLlmConfig.classify,
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
			return Response.redirect(new URL("/integrations/notion?connected=1", request.url), 302);
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
		url.pathname.startsWith("/api/remember") ||
		url.pathname.startsWith("/api/forget") ||
		url.pathname.startsWith("/api/feedback") ||
		url.pathname.startsWith("/api/memories") ||
		url.pathname.startsWith("/api/entities") ||
		url.pathname.startsWith("/api/timeline") ||
		url.pathname.startsWith("/api/changes") ||
		url.pathname.startsWith("/api/documents") ||
		(url.pathname.startsWith("/api/sources") && !isPublicNotionOAuth) ||
		url.pathname.startsWith("/api/keys") ||
		url.pathname.startsWith("/api/grants") ||
		url.pathname.startsWith("/api/admin/");

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
			return json({ error: "invalid_input", hint: "query is required" }, 400);
		}
		const result = await agent.recall(query);
		if ((query.format ?? "json") === "markdown") {
			return new Response(result.markdown ?? "", {
				headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" },
			});
		}
		return json(result);
	}

	if (url.pathname === "/api/remember" && request.method === "POST") {
		const raw = await request.json().catch(() => null);
		const body = decodeBody(RememberToolInput, raw ?? {});
		if (!body || (!body.text && !body.items)) {
			return json({ error: "invalid_input", hint: "text or items[] is required" }, 400);
		}
		const result = await agent.remember({
			...body,
			sourceId: `agent:${auth.userId}`,
		});
		return json(result, 201);
	}

	if (url.pathname === "/api/forget" && request.method === "POST") {
		const raw = await request.json().catch(() => null);
		const body = decodeBody(ForgetToolInput, raw ?? {});
		if (!body) {
			return json({ error: "invalid_input", hint: "id or query is required" }, 400);
		}
		try {
			return json(await agent.forget(body));
		} catch (caught) {
			const message = caught instanceof Error ? caught.message : String(caught);
			return json({ error: "invalid_input", hint: message }, 400);
		}
	}

	if (url.pathname === "/api/feedback" && request.method === "POST") {
		const raw = await request.json().catch(() => null);
		const body = decodeBody(FeedbackToolInput, raw ?? {});
		if (!body) {
			return json({ error: "invalid_input", hint: "id and signal are required" }, 400);
		}
		return json(await agent.feedback({ ...body, clientId: auth.userId }));
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

	if (url.pathname === "/api/admin/reindex" && request.method === "POST") {
		return json(await agent.reindex());
	}

	if (url.pathname === "/api/admin/sweep" && request.method === "POST") {
		const raw = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
		return json(
			await agent.sweep({
				...(typeof raw.cursor === "string" ? { cursor: raw.cursor } : {}),
				...(typeof raw.now === "number" ? { now: raw.now } : {}),
				...(typeof raw.maxActive === "number" ? { maxActive: raw.maxActive } : {}),
			}),
		);
	}

	if (url.pathname === "/api/admin/restore" && request.method === "POST") {
		const raw = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
		if (typeof raw.id !== "string") {
			return json({ error: "invalid_input", hint: "id is required" }, 400);
		}
		return json(await agent.restoreMemory(raw.id));
	}

	if (url.pathname === "/api/admin/promote" && request.method === "POST") {
		return json(await agent.promote());
	}

	if (url.pathname === "/api/admin/split-entity" && request.method === "POST") {
		const raw = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
		if (typeof raw.id !== "string" || typeof raw.newName !== "string") {
			return json({ error: "invalid_input", hint: "id and newName are required" }, 400);
		}
		return json(await agent.splitEntity({ id: raw.id, newName: raw.newName }));
	}

	if (url.pathname === "/api/entities" && request.method === "GET") {
		return json({ markdown: await agent.entityIndex() });
	}

	if (url.pathname === "/api/entities" && request.method === "POST") {
		const raw = await request.json().catch(() => null);
		const body = decodeBody(GetEntityToolInput, raw ?? {});
		if (!body || (!body.name && !body.id)) {
			return json({ error: "invalid_input", hint: "name or id is required" }, 400);
		}
		const view = await agent.getEntity(body);
		if (!view) {
			return json({ error: "not_found", hint: "entity was not found" }, 404);
		}
		return json(view);
	}

	if (url.pathname === "/api/timeline" && request.method === "POST") {
		const raw = await request.json().catch(() => null);
		const body = decodeBody(TimelineToolInput, raw ?? {});
		if (!body) {
			return json({ error: "invalid_input", hint: "about is required" }, 400);
		}
		return json(await agent.timeline(body));
	}

	if (url.pathname === "/api/changes" && request.method === "POST") {
		const raw = await request.json().catch(() => null);
		const body = decodeBody(ChangesSinceToolInput, raw ?? {});
		if (!body) {
			return json({ error: "invalid_input", hint: "since is required" }, 400);
		}
		return json(await agent.changesSince(body.since));
	}

	if (url.pathname.startsWith("/api/memories/") && request.method === "PATCH") {
		const id = url.pathname.slice("/api/memories/".length);
		const raw = await request.json().catch(() => null);
		const body = decodeBody(UpdateMemoryToolInput, {
			...(raw && typeof raw === "object" ? raw : {}),
			id,
		});
		if (!body) {
			return json({ error: "invalid_input", hint: "id is required" }, 400);
		}
		try {
			return json(await agent.updateMemory(body));
		} catch {
			return json({ error: "not_found", hint: `memory ${id} was not found` }, 404);
		}
	}

	if (url.pathname.startsWith("/api/memories/") && request.method === "GET") {
		const id = url.pathname.slice("/api/memories/".length);
		try {
			return json(await agent.getMemoryDetail(id));
		} catch {
			return json({ error: "not_found", hint: `memory ${id} was not found` }, 404);
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
