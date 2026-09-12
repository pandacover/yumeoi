import { InvalidRequest, type Memory, NotFound, type RememberOutcomeItem } from "@yumeoi/domain";
import { Effect } from "effect";
import { nowMillis } from "./clock.ts";
import { MemoryRepo } from "./memory-repo.ts";
import { applyMemoryText, refineMemoryFromUse } from "./refine.ts";
import { ftsMatchQuery } from "./rrf.ts";
import { restoreArchivedMemory } from "./sweep.ts";
import { VectorIndex } from "./vector-index.ts";

const writableOrigins = new Set(["agent", "user", "chat"]);
const memoryVectorId = (id: string) => `m:${id}`;

export const updateMemoryRecord = (input: {
	readonly id: string;
	readonly text?: string;
	readonly validTo?: string | null;
	readonly importance?: number;
	readonly kind?: Memory["kind"];
	readonly eventAt?: string | null;
	readonly namespace?: string;
}) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const now = yield* nowMillis;
		let current = yield* repo.getMemory(input.id);
		if (current.state === "archived") {
			current = yield* restoreArchivedMemory(input.id, input.namespace ?? "default");
		}
		const previous = current;
		const eventAt =
			input.eventAt === undefined ? undefined : input.eventAt ? Date.parse(input.eventAt) : null;
		if (input.text !== undefined && input.text !== current.text) {
			current = yield* applyMemoryText({
				memory: current,
				text: input.text,
				namespace: input.namespace ?? "default",
				reason: "correct",
			});
		}
		const updated = yield* repo.updateMemory(input.id, {
			...(input.validTo !== undefined ? { validTo: input.validTo } : {}),
			...(input.importance !== undefined ? { importance: input.importance } : {}),
			...(input.kind !== undefined ? { kind: input.kind } : {}),
			...(eventAt !== undefined ? { eventAt: Number.isFinite(eventAt) ? eventAt : null } : {}),
		});
		if (input.text === undefined) {
			yield* repo.insertHistory({
				memoryId: updated.id,
				text: updated.text,
				type: updated.type,
				kind: updated.kind,
				confidence: updated.confidence,
				validFrom: updated.validFrom,
				validTo: updated.validTo,
				state: updated.state,
				reason: "correct",
				changedAt: now,
			});
		}
		return { memory: updated, previous };
	});

export const forgetMemories = (input: {
	readonly id?: string;
	readonly query?: string;
	readonly confirm?: boolean;
	readonly reason?: string;
	readonly userId: string;
}) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const index = yield* VectorIndex;
		const now = yield* nowMillis;
		const ids: string[] = [];
		if (input.id) {
			ids.push(input.id);
		} else if (input.query && input.confirm) {
			const match = ftsMatchQuery(input.query);
			if (match) {
				const hits = yield* repo.searchMemoryFts(match, {
					sources: [],
					kinds: [],
					since: null,
					limit: 20,
				});
				ids.push(...hits.map((hit) => hit.id));
			}
		} else {
			return yield* Effect.fail(
				new InvalidRequest({ message: "forget requires id, or query plus confirm=true" }),
			);
		}
		const forgotten: string[] = [];
		for (const id of ids) {
			const memory = yield* repo.getMemory(id);
			if (!writableOrigins.has(memory.origin) && !input.confirm) {
				return yield* Effect.fail(
					new InvalidRequest({
						message: `memory ${id} is extracted; pass confirm=true to forget it`,
					}),
				);
			}
			if (memory.state === "archived") {
				yield* repo.restoreMemory(id, now);
			}
			yield* repo.updateMemory(id, { state: "forgotten" });
			yield* repo.insertHistory({
				memoryId: id,
				text: memory.text,
				type: memory.type,
				kind: memory.kind,
				confidence: memory.confidence,
				validFrom: memory.validFrom,
				validTo: memory.validTo,
				state: "forgotten",
				reason: input.reason ?? "forget",
				changedAt: now,
			});
			yield* index
				.deleteByIds([memoryVectorId(id)])
				.pipe(Effect.catchTag("ProviderUnavailable", () => Effect.void));
			forgotten.push(id);
		}
		return { ids: forgotten };
	});

export const recordFeedback = (input: {
	readonly id: string;
	readonly signal: 1 | -1;
	readonly note?: string;
	readonly query?: string;
	readonly clientId: string;
	readonly namespace?: string;
}) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const memory = yield* repo.getMemory(input.id);
		yield* repo.insertFeedback({
			memoryId: input.id,
			clientId: input.clientId,
			signal: input.signal,
			...(input.note ? { note: input.note } : {}),
		});
		const namespace = input.namespace ?? "default";
		const refined =
			input.signal === -1
				? yield* refineMemoryFromUse({
						memory,
						namespace,
						...(input.note ? { note: input.note } : {}),
						...(input.query ? { query: input.query } : {}),
					})
				: { action: "scored" as const, memory };
		const latest = refined.memory;
		const nextImportance = Math.min(
			1,
			Math.max(
				0,
				latest.importance +
					(input.signal === 1 ? 0.05 : refined.action === "scored" ? -0.2 : -0.05),
			),
		);
		if (input.signal === 1 && latest.state === "archived") {
			yield* restoreArchivedMemory(input.id, namespace);
		}
		const patch =
			input.signal === -1 && refined.action === "scored" && nextImportance <= 0.1
				? { importance: nextImportance, state: "dormant" as const }
				: input.signal === 1 && latest.state === "dormant"
					? { importance: nextImportance, state: "active" as const }
					: { importance: nextImportance };
		yield* repo.updateMemory(input.id, patch);
		return {
			ok: true as const,
			id: input.id,
			action: refined.action,
			...(refined.action !== "scored" ? { text: refined.memory.text } : {}),
		};
	});

export const getMemoryDetail = (id: string) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const memory = yield* repo
			.getMemory(id)
			.pipe(
				Effect.mapError((error) =>
					error instanceof NotFound ? error : new NotFound({ entity: "memory", id }),
				),
			);
		const history = yield* repo.listHistory(id);
		const edges = yield* repo.listEdges([id]);
		const provenance = yield* repo.provenanceFor([id]);
		return {
			memory,
			history,
			edges,
			entities: memory.entities,
			provenance: provenance.map(({ memoryId: _memoryId, ...rest }) => rest),
		};
	});

export type ForgetResult = { readonly ids: ReadonlyArray<string> };
export type FeedbackResult = {
	readonly ok: true;
	readonly id: string;
	readonly action: "scored" | "rewritten" | "reextracted";
	readonly text?: string;
};
export type RememberBatch = { readonly items: ReadonlyArray<RememberOutcomeItem> };
