import { Effect } from "effect";
import { resolveName } from "../graph/resolve.ts";
import { MemoryRepo } from "../memory-repo.ts";
import { remember } from "../remember.ts";

const MS_DAY = 86_400_000;

const clusterKey = (text: string): string =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 4)
		.join(" ");

export const promoteEpisodes = (userId: string, now = Date.now()) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const cutoff = now - 14 * MS_DAY;
		const episodes = yield* repo.listRecentEpisodic(0, 500);
		const old = episodes.filter(
			(memory) => (memory.eventAt ?? memory.observedAt ?? memory.updatedAt ?? 0) <= cutoff,
		);
		const groups = new Map<string, typeof old>();
		for (const memory of old) {
			const key = `${memory.entities[0]?.id ?? "none"}:${memory.kind}`;
			const list = groups.get(key) ?? [];
			list.push(memory);
			groups.set(key, list);
		}
		const created: string[] = [];
		for (const [, cluster] of groups) {
			if (cluster.length < 3) {
				continue;
			}
			const text = cluster.map((memory) => memory.text).join(" ");
			const outcome = yield* remember({
				userId,
				text: `Standing summary: ${text.slice(0, 400)}`,
				mode: "verbatim",
				dedupe: true,
				origin: "derived",
				sourceId: `derived:${userId}`,
			});
			const id = outcome.items[0]?.id;
			if (!id) {
				continue;
			}
			created.push(id);
			for (const episode of cluster) {
				yield* repo.insertEdge(id, episode.id, "derived_from");
				yield* repo.updateMemory(episode.id, {
					importance: Math.max(0, episode.importance - 0.2),
				});
			}
		}
		return {
			created: created.length,
			ids: created,
			clusters: [...groups.values()].filter((item) => item.length >= 3).length,
		};
	});

export const induceProcedures = (userId: string) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const recent = yield* repo.listRecentMemories(300);
		const candidates = recent.filter(
			(memory) =>
				memory.kind === "rule" ||
				memory.kind === "procedure" ||
				(memory.type === "episodic" && (memory.kind === "task" || memory.kind === "decision")),
		);
		const groups = new Map<string, typeof candidates>();
		for (const memory of candidates) {
			const key = clusterKey(memory.text);
			if (key.length < 8) {
				continue;
			}
			const list = groups.get(key) ?? [];
			list.push(memory);
			groups.set(key, list);
		}
		const created: string[] = [];
		for (const [, cluster] of groups) {
			if (cluster.length < 3) {
				continue;
			}
			const text = `When this happens: ${cluster[0]?.text ?? ""}`;
			const outcome = yield* remember({
				userId,
				items: [
					{
						text: text.slice(0, 400),
						type: "procedural",
						kind: "procedure",
						importance: 0.7,
					},
				],
				mode: "verbatim",
				dedupe: true,
				origin: "derived",
				sourceId: `derived:${userId}`,
			});
			const id = outcome.items[0]?.id;
			if (!id) {
				continue;
			}
			created.push(id);
			for (const item of cluster) {
				yield* repo.insertEdge(id, item.id, "derived_from");
			}
		}
		return { created: created.length, ids: created };
	});

export const runLayerJobs = (userId: string, now = Date.now()) =>
	Effect.gen(function* () {
		const promoted = yield* promoteEpisodes(userId, now);
		const procedures = yield* induceProcedures(userId);
		return { promoted, procedures };
	});

export const recordChatEpisode = (userId: string, text: string) =>
	Effect.gen(function* () {
		const lower = text.toLowerCase();
		if (!/\b(prefer|prefers|decided|decision|will|commit|agreed)\b/.test(lower)) {
			return { recorded: false as const };
		}
		yield* remember({
			userId,
			text,
			mode: "verbatim",
			origin: "chat",
			sourceId: `chat:${userId}`,
		});
		return { recorded: true as const };
	});

export const profileLines = (_userId: string, limit = 25) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const memories = yield* repo.listProfileMemories(limit);
		return memories
			.filter((memory) => memory.type === "semantic" && memory.state === "active")
			.map((memory) => `- ${memory.text}`)
			.join("\n");
	});

export const timelineAbout = (input: {
	readonly userId: string;
	readonly about: string;
	readonly from?: number | null;
	readonly to?: number | null;
	readonly limit?: number;
}) =>
	Effect.gen(function* () {
		const now = Date.now();
		const resolved = yield* resolveName(input.about, input.userId, now, { create: false });
		const repo = yield* MemoryRepo;
		return yield* repo.listTimeline({
			entityId: resolved?.id ?? "",
			about: input.about,
			from: input.from ?? null,
			to: input.to ?? null,
			limit: input.limit ?? 20,
		});
	});

export const changesSince = (since: number) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		return yield* repo.listChangesSince(since);
	});
