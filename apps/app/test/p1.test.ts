import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const auth = { authorization: `Bearer ${env.YUMEOI_API_KEY}` };

describe("P1 workerd", () => {
	it("addMemory returns type and state and uses a short id", async () => {
		const stub = env.MemoryAgent.getByName("p1-add-user");
		const memory = await stub.addMemory({
			text: "Luv prefers oat milk in coffee rather than dairy milk.",
			kind: "preference",
			confidence: 0.9,
		});
		expect(memory.text).toContain("oat milk");
		expect(memory.type).toBe("semantic");
		expect(memory.state).toBe("active");
		expect(memory.origin).toBe("agent");
		expect(memory.id).toMatch(/^m_[0-9a-hjkmnp-tv-z]{12}$/);
	});

	it("ingest backfills v2 columns on extracted memories", async () => {
		const stub = env.MemoryAgent.getByName("p1-migrate-user");
		const ingest = await stub.ingest({
			externalId: "p1-migrate",
			title: "Prefs",
			markdown: "Luv prefers Effect 4 for the yumeoi domain layer and uses it everywhere.",
			sourceId: "generic",
			sourceLabel: "Notes",
			url: null,
		});
		expect(ingest.memoryCount).toBeGreaterThan(0);
		const hits = await stub.search({ query: "Effect 4", limit: 10 });
		expect(hits.length).toBeGreaterThan(0);
		expect(
			hits.every(
				(hit) =>
					hit.memory.type === "semantic" ||
					hit.memory.type === "episodic" ||
					hit.memory.type === "procedural",
			),
		).toBe(true);
		expect(hits.every((hit) => hit.memory.state === "active")).toBe(true);
	});

	it("reindex upserts active vectors against the local Vectorize emulator", async () => {
		const stub = env.MemoryAgent.getByName("p1-reindex-user");
		const memory = await stub.addMemory({
			text: "yumeoi stores per-user memories inside a Durable Object.",
			kind: "fact",
			confidence: 0.8,
		});
		expect(memory.id).toBeTruthy();
		const result = await stub.reindex();
		expect(result.memories).toBeGreaterThan(0);
		expect(result.deleted).toBeGreaterThanOrEqual(0);
		const hits = await stub.search({ query: "Durable Object", limit: 10 });
		expect(hits.some((hit) => hit.memory.id === memory.id)).toBe(true);
	});

	it("POST /api/admin/reindex is authenticated and returns counts", async () => {
		const write = await SELF.fetch("https://example.com/api/memories", {
			method: "POST",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({
				text: "The Vectorize index used by yumeoi is named yumeoi-memories.",
				kind: "fact",
				confidence: 0.8,
			}),
		});
		expect(write.status).toBe(201);
		const created = (await write.json()) as { type: string; state: string };
		expect(created.type).toBe("semantic");
		expect(created.state).toBe("active");

		const denied = await SELF.fetch("https://example.com/api/admin/reindex", { method: "POST" });
		expect(denied.status).toBe(401);

		const reindex = await SELF.fetch("https://example.com/api/admin/reindex", {
			method: "POST",
			headers: auth,
		});
		expect(reindex.status).toBe(200);
		const body = (await reindex.json()) as { memories: number; chunks: number; deleted: number };
		expect(body.memories).toBeGreaterThan(0);
	});
});
