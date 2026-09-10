import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const auth = { authorization: `Bearer ${env.YUMEOI_API_KEY}` };

describe("P3 retrieval", () => {
	it("HTTP recall defaults to JSON and only packs active memories", async () => {
		const write = await SELF.fetch("https://example.com/api/remember", {
			method: "POST",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({
				text: "The deploy target is the custom domain yumeoi.app.",
				mode: "verbatim",
				clientRef: "p3-deploy-current",
			}),
		});
		expect(write.status).toBe(201);

		const started = Date.now();
		const response = await SELF.fetch("https://example.com/api/recall", {
			method: "POST",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({ query: "deploy target", budgetTokens: 800 }),
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type") ?? "").toContain("application/json");
		const body = (await response.json()) as {
			memories: Array<{ memory: { text: string; state: string } }>;
		};
		expect(Array.isArray(body.memories)).toBe(true);
		expect(body.memories.every((hit) => hit.memory.state === "active")).toBe(true);
		expect(body.memories.some((hit) => hit.memory.text.toLowerCase().includes("yumeoi.app"))).toBe(
			true,
		);
		expect(Date.now() - started).toBeLessThan(800);
	}, 30_000);

	it("keyword search stems deploying to deploy", async () => {
		const stub = env.MemoryAgent.getByName("p3-stem-user");
		const remembered = await stub.remember({
			text: "When deploying yumeoi, run bun run deploy:dry-run first.",
			mode: "verbatim",
		});
		expect(remembered.items.length).toBeGreaterThan(0);
		const hits = await stub.search({ query: "deploy", limit: 10 });
		expect(hits.some((hit) => hit.memory.text.toLowerCase().includes("deploy"))).toBe(true);
	}, 30_000);
});
