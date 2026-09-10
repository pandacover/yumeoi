import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const auth = { authorization: `Bearer ${env.YUMEOI_API_KEY}` };
const MS_DAY = 86_400_000;

describe("P6 decay and lifecycle", () => {
	it("sweep archives unused episodic memories and health exposes stats", async () => {
		const stub = env.MemoryAgent.getByName("p6-sweep-user");
		const now = Date.now();
		await stub.remember({
			items: [
				{
					text: "On 2026-01-01 Luv mentioned a throwaway hallway chat about snacks.",
					type: "episodic",
					kind: "event",
					importance: 0.05,
				},
			],
			mode: "verbatim",
			origin: "extracted",
			observedAt: now,
			dedupe: false,
		});
		await stub.remember({
			text: "Luv prefers dark mode in the editor at all times.",
			mode: "verbatim",
			origin: "user",
		});
		const mid = await stub.sweep({ now: now + 61 * MS_DAY });
		expect(mid.dormanted.length + mid.archived.length + mid.scanned).toBeGreaterThan(0);
		const later = await stub.sweep({ now: now + 160 * MS_DAY });
		expect(later.stats.lastSweepAt).toBeTruthy();
		expect(later.stats.active).toBeGreaterThan(0);

		const health = await SELF.fetch("https://example.com/api/health");
		expect(health.status).toBe(200);
		const body = (await health.json()) as { phase?: string; memory?: { active: number } };
		expect(body.phase).toBe("p6");
		expect(body.memory).toBeTruthy();
	}, 30_000);

	it("forget hard-deletes after the 30-day grace and restore brings archived rows back", async () => {
		const stub = env.MemoryAgent.getByName("p6-forget-user");
		const now = Date.now();
		const created = await stub.remember({
			items: [
				{
					text: "Luv asked to forget this scratch note about lunch plans.",
					type: "semantic",
					kind: "fact",
				},
			],
			mode: "verbatim",
			origin: "agent",
		});
		const id = created.items[0]?.id ?? "";
		expect(id).toBeTruthy();
		await stub.forget({ id, confirm: true });
		const stillThere = await stub.getMemory(id);
		expect(stillThere.state).toBe("forgotten");
		await stub.sweep({ now: now + 31 * MS_DAY });
		await expect(stub.getMemory(id)).rejects.toThrow();

		const noisy = await stub.remember({
			items: [
				{
					text: "On 2026-01-01 newsletter noise mentioned a cafe opening downtown.",
					type: "episodic",
					kind: "event",
					importance: 0.05,
				},
			],
			mode: "verbatim",
			origin: "extracted",
			observedAt: now,
			dedupe: false,
		});
		const noisyId = noisy.items[0]?.id ?? "";
		await stub.sweep({ now: now + 61 * MS_DAY });
		await stub.sweep({ now: now + 160 * MS_DAY });
		const archived = await stub.listArchived(20);
		const target = archived.find((memory) => memory.id === noisyId) ?? archived[0];
		expect(target).toBeTruthy();
		if (target) {
			const restored = await stub.restoreMemory(target.id);
			expect(restored.state).toBe("active");
		}

		const sweepHttp = await SELF.fetch("https://example.com/api/admin/sweep", {
			method: "POST",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({ now: now + 160 * MS_DAY }),
		});
		expect(sweepHttp.status).toBe(200);
	}, 30_000);
});
