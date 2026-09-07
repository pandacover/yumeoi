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
});

describe("HTTP ingest and recall", () => {
	it("serves health for m1", async () => {
		const response = await SELF.fetch("https://example.com/api/health");
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			milestone: string;
			extractModel: { model: string; effort: string };
		};
		expect(body.milestone).toBe("m1");
		expect(body.extractModel).toEqual({ model: "gpt-5.6-luna", effort: "low" });
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
	});
});
