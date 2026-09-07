import { defaultLlmConfig, MEMORY_KINDS, type MemoryKind } from "@yumeoi/domain";
import { authenticateRequest, unauthorized } from "../auth/api-key.ts";
import { handleSpikes } from "./spikes.ts";

const json = (body: unknown, status = 200) =>
	Response.json(body, {
		status,
		headers: { "cache-control": "no-store" },
	});

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

const ingestBody = async (request: Request) => {
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body.externalId !== "string" || typeof body.markdown !== "string") {
		return null;
	}
	return {
		externalId: body.externalId,
		title: typeof body.title === "string" ? body.title : body.externalId,
		markdown: body.markdown,
		sourceId: typeof body.sourceId === "string" ? body.sourceId : "generic",
		sourceLabel: typeof body.sourceLabel === "string" ? body.sourceLabel : "Generic ingest",
		url: typeof body.url === "string" ? body.url : null,
	};
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
		url.pathname.startsWith("/api/sources");

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
		const body = await ingestBody(request);
		if (!body) {
			return json({ error: "externalId and markdown are required" }, 400);
		}
		const result = await agent.ingest(body);
		return json(result, result.unchanged ? 200 : 201);
	}

	if (url.pathname === "/api/search" && request.method === "POST") {
		const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
		if (typeof body.query !== "string") {
			return json({ error: "query is required" }, 400);
		}
		const hits = await agent.search({
			query: body.query,
			sources: asStrings(body.sources),
			kinds: asKinds(body.kinds),
			since: typeof body.since === "number" ? body.since : null,
			limit: typeof body.limit === "number" ? body.limit : 20,
		});
		return json({ memories: hits });
	}

	if (url.pathname === "/api/recall" && request.method === "POST") {
		const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
		if (typeof body.query !== "string") {
			return json({ error: "query is required" }, 400);
		}
		const result = await agent.recall({
			query: body.query,
			sources: asStrings(body.sources),
			kinds: asKinds(body.kinds),
			since: typeof body.since === "number" ? body.since : null,
			budgetTokens: typeof body.budgetTokens === "number" ? body.budgetTokens : 2000,
			rerank: body.rerank === true,
		});
		return json(result);
	}

	if (url.pathname === "/api/memories" && request.method === "POST") {
		const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
		if (typeof body.text !== "string") {
			return json({ error: "text is required" }, 400);
		}
		const kind = asKinds([body.kind])[0] ?? "fact";
		const memory = await agent.addMemory({
			text: body.text,
			kind,
			confidence: typeof body.confidence === "number" ? body.confidence : 1,
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

	if (url.pathname.startsWith("/api/") || url.pathname === "/ingest") {
		return json({ error: "not found" }, 404);
	}

	return null;
}
