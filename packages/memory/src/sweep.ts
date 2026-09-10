import type { Memory, MemoryStats } from "@yumeoi/domain";
import { Effect } from "effect";
import { nowMillis } from "./clock.ts";
import { Embeddings } from "./embeddings.ts";
import { runLayerJobs } from "./layers/promote.ts";
import { MemoryRepo } from "./memory-repo.ts";
import {
	FORGET_GRACE_MS,
	MAX_ACTIVE_MEMORIES,
	normalizeMemoryText,
	retentionScore,
	SWEEP_SLICE,
	shouldArchive,
	shouldDormant,
} from "./retention.ts";
import { VectorIndex } from "./vector-index.ts";

const memoryVectorId = (id: string) => `m:${id}`;

export type SweepInput = {
	readonly userId: string;
	readonly now?: number;
	readonly cursor?: string | null;
	readonly maxActive?: number;
	readonly sliceSize?: number;
	readonly skipPromote?: boolean;
	readonly log?: boolean;
};

export type SweepResult = {
	readonly scanned: number;
	readonly dormanted: ReadonlyArray<string>;
	readonly archived: ReadonlyArray<string>;
	readonly forgotten: ReadonlyArray<string>;
	readonly merged: ReadonlyArray<string>;
	readonly budgeted: ReadonlyArray<string>;
	readonly vectorsDeleted: ReadonlyArray<string>;
	readonly stats: MemoryStats;
	readonly nextCursor: string | null;
	readonly done: boolean;
};

const historyFor = (memory: Memory, state: Memory["state"], reason: string, now: number) => ({
	memoryId: memory.id,
	text: memory.text,
	type: memory.type,
	kind: memory.kind,
	confidence: memory.confidence,
	validFrom: memory.validFrom,
	validTo: memory.validTo,
	state,
	reason,
	changedAt: now,
});

const deleteVectors = (ids: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		if (ids.length === 0) {
			return;
		}
		const index = yield* VectorIndex;
		yield* index
			.deleteByIds(ids.map((id) => memoryVectorId(id)))
			.pipe(Effect.catchTag("ProviderUnavailable", () => Effect.void));
	});

const mergeExactDuplicates = (now: number) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const merged: string[] = [];
		const vectors: string[] = [];
		let afterId: string | null = null;
		const groups = new Map<string, Memory[]>();
		for (;;) {
			const page: ReadonlyArray<Memory> = yield* repo.listMemoriesPage({
				afterId,
				limit: SWEEP_SLICE,
				activeOnly: false,
			});
			if (page.length === 0) {
				break;
			}
			for (const memory of page) {
				if (memory.state !== "active" && memory.state !== "dormant") {
					continue;
				}
				const key = `${memory.type}:${normalizeMemoryText(memory.text)}`;
				const list = groups.get(key) ?? [];
				list.push(memory);
				groups.set(key, list);
			}
			afterId = page[page.length - 1]?.id ?? null;
			if (page.length < SWEEP_SLICE) {
				break;
			}
		}
		for (const [, group] of groups) {
			if (group.length < 2) {
				continue;
			}
			const ranked = [...group].sort(
				(left, right) =>
					right.importance * right.retention - left.importance * left.retention ||
					(left.observedAt ?? 0) - (right.observedAt ?? 0) ||
					left.id.localeCompare(right.id),
			);
			const keeper = ranked[0];
			if (!keeper) {
				continue;
			}
			yield* repo.insertHistory(historyFor(keeper, keeper.state, "merge", now));
			for (const duplicate of ranked.slice(1)) {
				yield* repo.insertHistory(historyFor(duplicate, "forgotten", "merge", now));
				yield* repo.hardDeleteMemory(duplicate.id);
				merged.push(duplicate.id);
				vectors.push(duplicate.id);
			}
		}
		yield* deleteVectors(vectors);
		return { merged, vectors };
	});

const enforceBudget = (now: number, maxActive: number) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const active = yield* repo.countActive();
		const overflow = active - maxActive;
		if (overflow <= 0) {
			return { budgeted: [] as string[] };
		}
		const lowest = yield* repo.listLowestRetentionActive(overflow);
		for (const memory of lowest) {
			yield* repo.updateMemory(memory.id, { state: "dormant" });
			yield* repo.insertHistory(historyFor(memory, "dormant", "decay", now));
		}
		return { budgeted: lowest.map((memory) => memory.id) };
	});

const hardDeleteForgotten = (now: number) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const forgotten: string[] = [];
		let afterId: string | null = null;
		for (;;) {
			const page: ReadonlyArray<Memory> = yield* repo.listMemoriesPage({
				afterId,
				limit: SWEEP_SLICE,
				activeOnly: false,
			});
			if (page.length === 0) {
				break;
			}
			for (const memory of page) {
				if (memory.state !== "forgotten") {
					continue;
				}
				const changed = yield* repo.lastStateChange(memory.id, "forgotten");
				const since = changed ?? memory.updatedAt ?? memory.observedAt ?? 0;
				if (now - since >= FORGET_GRACE_MS) {
					yield* repo.hardDeleteMemory(memory.id);
					forgotten.push(memory.id);
				}
			}
			afterId = page[page.length - 1]?.id ?? null;
			if (page.length < SWEEP_SLICE) {
				break;
			}
		}
		yield* deleteVectors(forgotten);
		return forgotten;
	});

export const sweepStore = (input: SweepInput) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const now = input.now ?? (yield* nowMillis);
		const sliceSize = input.sliceSize ?? SWEEP_SLICE;
		const maxActive = input.maxActive ?? MAX_ACTIVE_MEMORIES;
		const cursor = input.cursor ?? null;
		if (!cursor && !input.skipPromote) {
			yield* runLayerJobs(input.userId, now);
		}

		const page = yield* repo.listMemoriesPage({
			afterId: cursor,
			limit: sliceSize,
			activeOnly: false,
		});
		const ids = page.map((memory) => memory.id);
		const feedback = yield* repo.listFeedbackSums(ids);
		const feedbackById = new Map(feedback.map((row) => [row.id, row.sum]));
		const derivedParents = new Set(yield* repo.listDerivedParents(ids));
		const dormanted: string[] = [];
		const archived: string[] = [];
		const vectorsDeleted: string[] = [];

		for (const memory of page) {
			if (memory.state === "forgotten" || memory.state === "archived") {
				continue;
			}
			const retention = retentionScore({
				type: memory.type,
				importance: memory.importance,
				confidence: memory.confidence,
				now,
				lastAccessedAt: memory.lastAccessedAt,
				observedAt: memory.observedAt,
				accessCount: memory.accessCount,
				feedbackSum: feedbackById.get(memory.id) ?? 0,
				origin: memory.origin,
				hasDerivedChild: derivedParents.has(memory.id),
			});
			yield* repo.updateMemory(memory.id, { retention });
			const scored = { ...memory, retention };
			if (
				shouldDormant({
					state: scored.state,
					retention,
					now,
					lastAccessedAt: scored.lastAccessedAt,
					observedAt: scored.observedAt,
				})
			) {
				yield* repo.updateMemory(scored.id, { state: "dormant" });
				yield* repo.insertHistory(historyFor(scored, "dormant", "decay", now));
				dormanted.push(scored.id);
				continue;
			}
			const dormantSince = yield* repo.lastStateChange(scored.id, "dormant");
			if (
				shouldArchive({
					state: scored.state,
					retention,
					now,
					dormantSince,
				})
			) {
				yield* repo.insertHistory(historyFor(scored, "archived", "decay", now));
				yield* repo.archiveMemory(scored.id, now);
				archived.push(scored.id);
				vectorsDeleted.push(scored.id);
			}
		}

		yield* deleteVectors(vectorsDeleted);
		const done = page.length < sliceSize;
		const nextCursor = done ? null : (page[page.length - 1]?.id ?? null);
		let merged: string[] = [];
		let budgeted: string[] = [];
		let forgotten: string[] = [];
		if (done) {
			const dupes = yield* mergeExactDuplicates(now);
			merged = [...dupes.merged];
			vectorsDeleted.push(...dupes.vectors);
			const budget = yield* enforceBudget(now, maxActive);
			budgeted = [...budget.budgeted];
			forgotten = [...(yield* hardDeleteForgotten(now))];
			vectorsDeleted.push(...forgotten);
		}

		const previous = yield* repo.getStats();
		const live = yield* repo.getStats();
		const stats: MemoryStats = {
			...live,
			lastSweepAt: now,
			vectorsDeleted: previous.vectorsDeleted + new Set(vectorsDeleted).size,
			cursor: nextCursor,
		};
		yield* repo.writeStats(stats);
		const result: SweepResult = {
			scanned: page.length,
			dormanted,
			archived,
			forgotten,
			merged,
			budgeted,
			vectorsDeleted: [...new Set(vectorsDeleted)],
			stats,
			nextCursor,
			done,
		};
		if (input.log !== false) {
			yield* Effect.sync(() =>
				console.info("yumeoi sweep", {
					userId: input.userId,
					scanned: result.scanned,
					dormanted: result.dormanted.length,
					archived: result.archived.length,
					forgotten: result.forgotten.length,
					merged: result.merged.length,
					budgeted: result.budgeted.length,
					vectorsDeleted: result.vectorsDeleted.length,
					active: stats.active,
					done: result.done,
				}),
			);
		}
		return result;
	});

export const restoreArchivedMemory = (id: string, namespace: string) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const now = yield* nowMillis;
		const restored = yield* repo.restoreMemory(id, now);
		yield* repo.insertHistory(historyFor(restored, "active", "restore", now));
		const embeddings = yield* Embeddings;
		const index = yield* VectorIndex;
		const values = (yield* embeddings.embed([restored.text]))[0];
		if (values) {
			yield* index
				.upsert([
					{
						id: memoryVectorId(restored.id),
						values,
						namespace,
						metadata: {
							sourceId: "restore",
							kind: restored.kind,
							type: restored.type,
							state: "active",
							ts: restored.observedAt ?? now,
							eventAt: restored.eventAt ?? restored.observedAt ?? now,
						},
					},
				])
				.pipe(Effect.catchTag("ProviderUnavailable", () => Effect.void));
		}
		return restored;
	});
