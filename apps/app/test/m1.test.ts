import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const auth = { authorization: "Bearer ym_test_key" };

describe("MemoryAgent", () => {
	it("returns hello from RPC", async () => {
		const stub = env.MemoryAgent.getByName("demo");
		const result = await stub.hello("m1");
		expect(result.message).toBe("hello m1");
		expect(result.ready).toBe(true);
	});

	it("ingests a document and keyword-searches memories", async () => {
		const stub = env.MemoryAgent.getByName("fts-user");
		const ingest = await stub.ingest({
			externalId: "fts-doc",
			title: "FTS",
			markdown: "yumeoi stores memories in Durable Object SQLite with FTS5.",
			sourceId: "generic",
			sourceLabel: "Notes",
			url: null,
		});
		expect(ingest.unchanged).toBe(false);
		expect(ingest.memoryCount).toBeGreaterThan(0);

		const hits = await stub.search({ query: "FTS5", limit: 10 });
		expect(hits.length).toBeGreaterThan(0);
		expect(hits[0]?.memory.text).toMatch(/FTS5/);
	});

	it("startIngest runs the durable workflow and waits for completion", async () => {
		const stub = env.MemoryAgent.getByName("workflow-user");
		const ingest = await stub.startIngest({
			externalId: "wf-doc",
			title: "Workflow",
			markdown: "Luv prefers Effect 4 for the yumeoi domain layer.",
			sourceId: "generic",
			sourceLabel: "Notes",
			url: null,
		});
		expect(ingest.unchanged).toBe(false);
		expect(ingest.memoryCount).toBeGreaterThan(0);
		expect(ingest.instanceId).toBeTruthy();
	});
});

describe("HTTP ingest and recall", () => {
	it("serves health with pinned extract model", async () => {
		const response = await SELF.fetch("https://example.com/api/health");
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			milestone: string;
			extractModel: { model: string; effort: string };
			llm: { defaultProvider: string; fallbackProvider: string };
		};
		expect(["m1", "m2", "m3"]).toContain(body.milestone);
		expect(body.extractModel).toEqual({ model: "gpt-5.6-luna", effort: "high" });
		expect(body.llm.defaultProvider).toBe("openrouter");
		expect(body.llm.fallbackProvider).toBe("openai");
	});

	it("requires an LLM provider key for extract", async () => {
		const response = await SELF.fetch("https://example.com/api/spikes/extract", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "Luv is building yumeoi." }),
		});
		expect(response.status).toBe(503);
		const body = (await response.json()) as { error: string };
		expect(body.error).toContain("OPENROUTER_API_KEY");
	});

	it("rejects ingest without an API key", async () => {
		const response = await SELF.fetch("https://example.com/ingest", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ externalId: "x", markdown: "hello" }),
		});
		expect(response.status).toBe(401);
	});

	it("ingests then searches over HTTP", async () => {
		const ingest = await SELF.fetch("https://example.com/ingest", {
			method: "POST",
			headers: { "content-type": "application/json", ...auth },
			body: JSON.stringify({
				externalId: "http-doc",
				title: "HTTP",
				markdown: "Luv prefers Effect 4 for the yumeoi domain layer.",
			}),
		});
		expect(ingest.status).toBeGreaterThanOrEqual(200);
		expect(ingest.status).toBeLessThan(300);
		const ingestBody = (await ingest.json()) as {
			instanceId?: string;
			memoryCount: number;
			unchanged: boolean;
		};
		expect(ingestBody.unchanged).toBe(false);
		expect(ingestBody.memoryCount).toBeGreaterThan(0);
		expect(typeof ingestBody.instanceId).toBe("string");

		const search = await SELF.fetch("https://example.com/api/search", {
			method: "POST",
			headers: { "content-type": "application/json", ...auth },
			body: JSON.stringify({ query: "Effect 4" }),
		});
		expect(search.ok).toBe(true);
		const body = (await search.json()) as { memories: Array<{ memory: { text: string } }> };
		expect(body.memories.some((hit) => hit.memory.text.toLowerCase().includes("effect"))).toBe(
			true,
		);

		const recall = await SELF.fetch("https://example.com/api/recall", {
			method: "POST",
			headers: { "content-type": "application/json", ...auth },
			body: JSON.stringify({ query: "Effect 4" }),
		});
		expect(recall.ok).toBe(true);
		const recalled = (await recall.json()) as { memories: Array<{ memory: { text: string } }> };
		expect(recalled.memories.some((hit) => hit.memory.text.toLowerCase().includes("effect"))).toBe(
			true,
		);
	});
});

async function mcp(body: unknown) {
	return SELF.fetch("https://example.com/mcp", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			...auth,
		},
		body: JSON.stringify(body),
	});
}

describe("MCP memories", () => {
	it("requires an API key", async () => {
		const response = await SELF.fetch("https://example.com/mcp", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
		});
		expect(response.status).toBe(401);
	});

	it("lists search_memories and recall_context", async () => {
		const initialize = await mcp({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "yumeoi-tests", version: "0.1.0" },
			},
		});
		expect(initialize.status).toBeLessThan(500);

		const listed = await mcp({
			jsonrpc: "2.0",
			id: 2,
			method: "tools/list",
			params: {},
		});
		expect(listed.ok).toBe(true);
		const listedBody = await listed.text();
		expect(listedBody).toContain("search_memories");
		expect(listedBody).toContain("recall_context");
		expect(listedBody).not.toContain('"ping"');
	});

	it("lists memory://sources and memory://recent resources", async () => {
		await mcp({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "yumeoi-tests", version: "0.1.0" },
			},
		});
		const listed = await mcp({
			jsonrpc: "2.0",
			id: 3,
			method: "resources/list",
			params: {},
		});
		expect(listed.ok).toBe(true);
		const listedBody = await listed.text();
		expect(listedBody).toContain("memory://sources");
		expect(listedBody).toContain("memory://recent");
	});
});

describe("HTTP documents and keys", () => {
	it("hydrates get_document from R2 after ingest", async () => {
		const stub = env.MemoryAgent.getByName("r2-user");
		const ingest = await stub.ingest({
			externalId: "r2-doc",
			title: "R2",
			markdown: "Luv prefers Effect 4 for the yumeoi domain layer.",
			sourceId: "generic",
			sourceLabel: "Notes",
			url: null,
		});
		const document = await stub.getDocument(ingest.documentId);
		expect(document.r2Key).toBeTruthy();
		await env.DOCS.put(
			document.r2Key ?? "",
			JSON.stringify({
				title: "From R2",
				markdown: "hydrated-from-r2",
				url: null,
			}),
		);
		const hydrated = await stub.getDocument(ingest.documentId);
		expect(hydrated.markdown).toBe("hydrated-from-r2");
		expect(hydrated.title).toBe("From R2");
	});

	it("mints, lists, and revokes API keys", async () => {
		const minted = await SELF.fetch("https://example.com/api/keys", {
			method: "POST",
			headers: { ...auth },
		});
		expect(minted.status).toBe(201);
		const created = (await minted.json()) as { id: string; token: string; prefix: string };
		expect(created.token.startsWith("ym_")).toBe(true);

		const listed = await SELF.fetch("https://example.com/api/keys", {
			headers: { ...auth },
		});
		expect(listed.ok).toBe(true);
		const listBody = (await listed.json()) as { keys: Array<{ id: string }> };
		expect(listBody.keys.some((key) => key.id === created.id)).toBe(true);

		const revoked = await SELF.fetch(`https://example.com/api/keys/${created.id}`, {
			method: "DELETE",
			headers: { ...auth },
		});
		expect(revoked.ok).toBe(true);
	});

	it("tags add_memory with an agent source", async () => {
		const created = await SELF.fetch("https://example.com/api/memories", {
			method: "POST",
			headers: { "content-type": "application/json", ...auth },
			body: JSON.stringify({ text: "Luv prefers dark mode in the editor.", kind: "preference" }),
		});
		expect(created.status).toBe(201);
		const sources = await SELF.fetch("https://example.com/api/sources", {
			headers: { ...auth },
		});
		expect(sources.ok).toBe(true);
		const body = (await sources.json()) as { sources: Array<{ id: string }> };
		expect(body.sources.some((source) => source.id.startsWith("agent:"))).toBe(true);
	});
});
