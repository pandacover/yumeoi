import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("P0 workerd", () => {
	it("addMemory then search finds the written text", async () => {
		const stub = env.MemoryAgent.getByName("p0-add-user");
		const memory = await stub.addMemory({
			text: "Luv prefers oat milk in coffee at all times.",
			kind: "preference",
			confidence: 0.9,
		});
		expect(memory.text).toContain("oat milk");
		expect(memory.validTo).toBeNull();

		const hits = await stub.search({ query: "oat milk", limit: 10 });
		expect(hits.some((hit) => hit.memory.id === memory.id)).toBe(true);
		expect(hits.some((hit) => hit.memory.text.includes("oat milk"))).toBe(true);
	}, 30_000);

	it("keyword search applies kind filters before the limit", async () => {
		const stub = env.MemoryAgent.getByName("p0-filter-user");
		const ingest = await stub.ingest({
			externalId: "p0-filter",
			title: "Mixed",
			markdown:
				"Luv prefers Effect 4 for the yumeoi domain layer. Luv decided to run ingest on Cloudflare Workflows.",
			sourceId: "generic",
			sourceLabel: "Notes",
			url: null,
		});
		expect(ingest.memoryCount).toBeGreaterThan(0);

		const hits = await stub.search({ query: "Luv", kinds: ["preference"], limit: 10 });
		expect(hits.length).toBeGreaterThan(0);
		expect(hits.every((hit) => hit.memory.kind === "preference")).toBe(true);
	}, 30_000);
});
