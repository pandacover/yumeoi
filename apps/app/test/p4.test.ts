import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const auth = { authorization: `Bearer ${env.YUMEOI_API_KEY}` };

const mcp = (body: unknown) =>
	SELF.fetch("https://example.com/mcp", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			...auth,
		},
		body: JSON.stringify(body),
	});

describe("P4 graph RAG", () => {
	it("get_entity and memory://entities after remembering a relation", async () => {
		const stub = env.MemoryAgent.getByName("p4-graph-user");
		await stub.remember({
			text: "Anna leads Project Aurora for the Hamburg launch.",
			mode: "verbatim",
		});
		const view = await stub.getEntity({ name: "Anna", hops: 1 });
		expect(view).toBeTruthy();
		expect(view?.entity.name.toLowerCase()).toContain("anna");
		expect(view?.memories.length).toBeGreaterThan(0);
		const index = await stub.entityIndex();
		expect(index.toLowerCase()).toContain("anna");

		const listed = await mcp({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
		expect(listed.ok).toBe(true);
		expect(await listed.text()).toContain("get_entity");

		const split = await stub.splitEntity({
			id: view?.entity.id ?? "",
			newName: "Anna Chen",
		});
		expect(split.id).toMatch(/^e_/);
	}, 30_000);

	it("HTTP entity lookup returns relations", async () => {
		const write = await SELF.fetch("https://example.com/api/remember", {
			method: "POST",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({
				text: "Sam reports to Luv on connector work.",
				mode: "verbatim",
				clientRef: "p4-sam-1",
			}),
		});
		expect(write.status).toBe(201);
		const response = await SELF.fetch("https://example.com/api/entities", {
			method: "POST",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({ name: "Sam", hops: 1 }),
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as { entity: { name: string } };
		expect(body.entity.name.toLowerCase()).toContain("sam");
	}, 30_000);
});
