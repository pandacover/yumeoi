import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const auth = { authorization: `Bearer ${env.YUMEOI_API_KEY}` };
const MS_DAY = 86_400_000;

describe("P5 temporal and layers", () => {
	it("asOf recall hides the later version", async () => {
		const stub = env.MemoryAgent.getByName("p5-asof-user");
		const t1 = Date.parse("2026-01-15T00:00:00.000Z");
		const t2 = Date.parse("2026-06-15T00:00:00.000Z");
		const first = await stub.remember({
			items: [
				{
					text: "Chat is pinned to GPT-5.6 Terra at high effort.",
					type: "semantic",
					kind: "fact",
				},
			],
			mode: "verbatim",
			observedAt: t1,
			dedupe: false,
		});
		const oldId = first.items[0]?.id;
		expect(oldId).toBeTruthy();
		await stub.updateMemory({
			id: oldId ?? "",
			validTo: new Date(t2).toISOString(),
		});
		await stub.remember({
			items: [
				{
					text: "Chat is pinned to GPT-5.6 Luna at high effort.",
					type: "semantic",
					kind: "fact",
				},
			],
			mode: "verbatim",
			observedAt: t2,
			dedupe: false,
		});
		const march = await stub.recall({
			query: "chat model",
			asOf: Date.parse("2026-03-01T00:00:00.000Z"),
			rerank: false,
			format: "json",
		});
		const july = await stub.recall({
			query: "chat model",
			asOf: Date.parse("2026-07-01T00:00:00.000Z"),
			rerank: false,
			format: "json",
		});
		const marchText = march.memories.map((hit) => hit.memory.text).join(" ");
		const julyText = july.memories.map((hit) => hit.memory.text).join(" ");
		expect(marchText).toContain("Terra");
		expect(marchText).not.toContain("Luna");
		expect(julyText).toContain("Luna");
		expect(julyText).not.toContain("Terra");
	}, 30_000);

	it("promotion creates summaries with derived_from edges", async () => {
		const stub = env.MemoryAgent.getByName("p5-promote-user");
		const old = Date.now() - 20 * MS_DAY;
		for (const suffix of ["alpha", "bravo", "charlie"]) {
			await stub.remember({
				items: [
					{
						text: `On 2026-01-01 Luv met Anna about Aurora planning ${suffix}.`,
						type: "episodic",
						kind: "event",
						importance: 0.6,
					},
				],
				mode: "verbatim",
				origin: "extracted",
				observedAt: old,
				dedupe: false,
			});
		}
		const result = await stub.promote();
		expect(result.promoted.created).toBeGreaterThan(0);
		const summaryId = result.promoted.ids[0];
		expect(summaryId).toBeTruthy();
		const detail = await stub.getMemoryDetail(summaryId ?? "");
		expect(detail.edges.some((edge) => edge.relation === "derived_from")).toBe(true);
	}, 30_000);

	it("profile resource is semantic-only and chat episodics are recorded", async () => {
		const stub = env.MemoryAgent.getByName("p5-profile-user");
		await stub.remember({
			text: "Luv prefers dark mode in the editor at all times.",
			mode: "verbatim",
			origin: "user",
		});
		await stub.startChatTurn("We decided we will commit to Effect 4 for the domain layer.");
		const profile = await stub.profile();
		expect(profile.toLowerCase()).toContain("dark mode");
		expect(profile.toLowerCase()).not.toContain("standing summary");
		const changes = await stub.changesSince(0);
		expect(Array.isArray(changes)).toBe(true);
		const timeline = await stub.timeline({ about: "Luv", limit: 10 });
		expect(Array.isArray(timeline)).toBe(true);

		const httpProfile = await SELF.fetch("https://example.com/api/timeline", {
			method: "POST",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({ about: "Luv", limit: 5 }),
		});
		expect(httpProfile.status).toBe(200);
	}, 30_000);
});
