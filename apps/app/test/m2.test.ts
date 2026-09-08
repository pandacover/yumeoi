import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const auth = { authorization: "Bearer ym_test_key" };

describe("M2 SourceAgent + Notion fixture", () => {
	it("polls a fixture Notion workspace into MemoryAgent", async () => {
		const source = env.SourceAgent.getByName("notion:fixture:rpc");
		const connected = await source.attach({
			userId: "rpc-user",
			kind: "notion",
			label: "Demo Notion",
			accessToken: "fixture",
		});
		expect(connected.status).toBe("idle");
		expect(connected.kind).toBe("notion");

		const poll = await source.poll();
		expect(poll.seen).toBeGreaterThan(0);
		expect(poll.ingested).toBeGreaterThan(0);
		expect(poll.status).toBe("idle");

		const again = await source.poll();
		expect(again.status).toBe("idle");
		expect(again.ingested).toBe(0);

		const memories = await env.MemoryAgent.getByName("rpc-user").search({
			query: "Effect 4",
			limit: 10,
		});
		expect(memories.some((hit) => hit.memory.text.toLowerCase().includes("effect"))).toBe(true);
		expect(memories[0]?.provenance[0]?.title).toBeTruthy();

		const sources = await env.MemoryAgent.getByName("rpc-user").listSources();
		expect(sources.some((item) => item.id === "notion:fixture:rpc" && item.status === "idle")).toBe(
			true,
		);
	});
});

describe("M2 HTTP sources and memories", () => {
	it("serves health for m2", async () => {
		const response = await SELF.fetch("https://example.com/api/health");
		expect(response.status).toBe(200);
		const body = (await response.json()) as { milestone: string };
		expect(body.milestone).toBe("m2");
	});

	it("returns a Notion authorize URL when credentials are missing", async () => {
		const start = await SELF.fetch("https://example.com/api/sources/notion/authorize");
		expect(start.status).toBe(503);
	});

	it("connects a fixture source over HTTP and lists provenance", async () => {
		const created = await SELF.fetch("https://example.com/api/sources", {
			method: "POST",
			headers: { "content-type": "application/json", ...auth },
			body: JSON.stringify({ kind: "notion", fixture: true }),
		});
		expect(created.status).toBe(201);
		const createdBody = (await created.json()) as {
			source: { id: string; kind: string; status: string };
		};
		expect(createdBody.source.kind).toBe("notion");

		const listed = await SELF.fetch("https://example.com/api/sources", {
			headers: auth,
		});
		expect(listed.ok).toBe(true);
		const listedBody = (await listed.json()) as {
			sources: Array<{ id: string; kind: string }>;
		};
		expect(listedBody.sources.some((source) => source.id === createdBody.source.id)).toBe(true);

		const memories = await SELF.fetch("https://example.com/api/memories?query=Effect%204", {
			headers: auth,
		});
		expect(memories.ok).toBe(true);
		const memoryBody = (await memories.json()) as {
			memories: Array<{ memory: { text: string }; provenance: Array<{ title: string }> }>;
		};
		expect(
			memoryBody.memories.some((hit) => hit.memory.text.toLowerCase().includes("effect")),
		).toBe(true);
		expect(memoryBody.memories.some((hit) => hit.provenance.length > 0)).toBe(true);

		const sync = await SELF.fetch(
			`https://example.com/api/sources/${encodeURIComponent(createdBody.source.id)}/sync`,
			{ method: "POST", headers: auth },
		);
		expect(sync.ok).toBe(true);
		const syncBody = (await sync.json()) as { ingested: number; status: string };
		expect(syncBody.status).toBe("idle");
		expect(syncBody.ingested).toBe(0);
	});
});
