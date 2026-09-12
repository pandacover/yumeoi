import {
	type ConsolidateDecision,
	type ExtractedMemory,
	fillMemory,
	MEMORY_KINDS,
	type Memory,
	type MemoryOrigin,
	type RememberOutcomeItem,
} from "@yumeoi/domain";
import { Effect } from "effect";
import { Consolidator } from "./consolidator.ts";
import { cosineSimilarity } from "./cosine.ts";
import { Embeddings } from "./embeddings.ts";
import { writeGraphForMemory } from "./graph/write.ts";
import { newShortId } from "./ids.ts";
import { type CommitMemory, type InsertMemoryInput, MemoryRepo } from "./memory-repo.ts";
import { memoryVectorId } from "./recall.ts";
import { coerceTypeKind } from "./types.ts";
import { VALID_TO_SENTINEL, VectorIndex } from "./vector-index.ts";

const MEMORY_KIND_FILTER = { kind: { $in: [...MEMORY_KINDS] } };

export const parseEventAt = (value: string | null | undefined): number | null => {
	if (!value) {
		return null;
	}
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : null;
};

export const maySupersede = (
	candidate: { readonly observedAt: number; readonly eventAt: number | null },
	target: Memory,
	documentDate: number | null,
): boolean => {
	const targetObserved = target.observedAt ?? 0;
	if (candidate.observedAt < targetObserved) {
		return false;
	}
	const candidateEvent = candidate.eventAt ?? documentDate ?? candidate.observedAt;
	const targetEvent = target.eventAt ?? targetObserved;
	return candidateEvent >= targetEvent;
};

export const memoryVectorMeta = (
	memory: Pick<Memory, "kind" | "type" | "state" | "eventAt" | "observedAt" | "validTo">,
	sourceId: string,
	documentId: string,
	ts: number,
) => ({
	sourceId,
	documentId,
	kind: memory.kind,
	type: memory.type,
	state: memory.state,
	ts,
	eventAt: memory.eventAt ?? memory.observedAt ?? ts,
	validTo: memory.validTo ? Date.parse(memory.validTo) || VALID_TO_SENTINEL : VALID_TO_SENTINEL,
});

export const overlapCandidates = (
	existing: ReadonlyArray<Memory>,
	text: string,
): ReadonlyArray<Memory> => {
	const needle = text.toLowerCase();
	return existing
		.filter((memory) => {
			const hay = memory.text.toLowerCase();
			return hay.includes(needle.slice(0, 24)) || needle.includes(hay.slice(0, 24));
		})
		.slice(0, 5);
};

const uniqueMemories = (memories: ReadonlyArray<Memory>): Memory[] => {
	const seen = new Set<string>();
	const out: Memory[] = [];
	for (const memory of memories) {
		if (seen.has(memory.id)) {
			continue;
		}
		seen.add(memory.id);
		out.push(memory);
	}
	return out;
};

export const similarExistingMemories = (options: {
	readonly userId: string;
	readonly text: string;
	readonly values: ReadonlyArray<number>;
	readonly inBatch: ReadonlyArray<Memory>;
	readonly inBatchValues: ReadonlyMap<string, ReadonlyArray<number>>;
}) =>
	Effect.gen(function* () {
		const index = yield* VectorIndex;
		const repo = yield* MemoryRepo;

		const vectorHits = yield* index
			.query({
				values: options.values,
				namespace: options.userId,
				topK: 8,
				filter: MEMORY_KIND_FILTER,
			})
			.pipe(Effect.catchTag("ProviderUnavailable", () => Effect.succeed([])));

		const vectorIds = vectorHits
			.map((hit) => (hit.id.startsWith("m:") ? hit.id.slice(2) : null))
			.filter((id): id is string => Boolean(id));
		const fromVector =
			vectorIds.length > 0 ? yield* repo.listMemoriesByIds(vectorIds) : ([] as Memory[]);
		const byId = new Map(fromVector.map((memory) => [memory.id, memory]));
		const orderedVector = vectorIds.flatMap((id) => {
			const memory = byId.get(id);
			return memory ? [memory] : [];
		});

		const localRanked = [...options.inBatch]
			.map((memory) => ({
				memory,
				score: cosineSimilarity(options.values, options.inBatchValues.get(memory.id) ?? []),
			}))
			.sort((a, b) => b.score - a.score)
			.slice(0, 8)
			.map((row) => row.memory);

		if (orderedVector.length > 0 || localRanked.length > 0) {
			return uniqueMemories([...orderedVector, ...localRanked]).slice(0, 8);
		}

		const recent = yield* repo.similarMemoryCandidates([], 50);
		return overlapCandidates([...options.inBatch, ...recent], options.text);
	});

export const writeEntities = (
	memoryId: string,
	extracted: ExtractedMemory,
	values: ReadonlyArray<number> | undefined,
	userId: string,
	now: number,
) =>
	writeGraphForMemory({
		memoryId,
		userId,
		now,
		entities: extracted.entities,
		relations: extracted.relations,
		...(values ? { values } : {}),
		validFrom: extracted.validFrom,
	});

export const toOutcome = (
	action: RememberOutcomeItem["action"],
	memory: Memory,
	affected: ReadonlyArray<string> = [],
): RememberOutcomeItem => ({
	action,
	id: memory.id,
	text: memory.text,
	type: memory.type,
	kind: memory.kind,
	affected: [...affected],
});

export type ExtractedWriteContext = {
	readonly userId: string;
	readonly sourceId: string;
	readonly origin: MemoryOrigin;
	readonly documentDate: number | null;
	readonly dedupe: boolean;
	readonly observedAt?: number | null;
	readonly clientRef?: string;
	readonly documentId?: string;
	readonly chunkId?: string;
	readonly inBatch: ReadonlyArray<Memory>;
	readonly inBatchValues: ReadonlyMap<string, ReadonlyArray<number>>;
};

export type ExtractedWrite =
	| {
			readonly tag: "duplicate";
			readonly memory: Memory;
			readonly idempotent?: boolean;
	  }
	| {
			readonly tag: "merge";
			readonly target: Memory;
			readonly mergedText: string;
			readonly importance: number;
			readonly extracted: ExtractedMemory;
			readonly values: ReadonlyArray<number> | undefined;
			readonly chunkId?: string;
			readonly documentId?: string;
			readonly sourceId: string;
	  }
	| {
			readonly tag: "conflict";
			readonly target: Memory;
			readonly extracted: ExtractedMemory;
			readonly insert: InsertMemoryInput;
			readonly values: ReadonlyArray<number> | undefined;
			readonly sourceId: string;
			readonly documentId?: string;
	  }
	| {
			readonly tag: "insert";
			readonly extracted: ExtractedMemory;
			readonly insert: InsertMemoryInput;
			readonly supersedes: string | null;
			readonly target: Memory | null;
			readonly values: ReadonlyArray<number> | undefined;
			readonly sourceId: string;
			readonly documentId?: string;
			readonly chunkId?: string;
	  };

const fillFromExtracted = (
	id: string,
	extracted: ExtractedMemory,
	coerced: { readonly type: Memory["type"]; readonly kind: Memory["kind"] },
	options: {
		readonly validTo: string | null;
		readonly supersedes: string | null;
		readonly state: Memory["state"];
		readonly origin: MemoryOrigin;
		readonly eventAt: number | null;
		readonly importance: number;
		readonly confidence: number;
	},
): Memory =>
	fillMemory({
		id,
		kind: coerced.kind,
		text: extracted.text,
		confidence: options.confidence,
		validFrom: extracted.validFrom,
		validTo: options.validTo,
		supersedes: options.supersedes,
		type: coerced.type,
		state: options.state,
		importance: options.importance,
		eventAt: options.eventAt,
		origin: options.origin,
	});

export const planExtractedWrite = (extracted: ExtractedMemory, context: ExtractedWriteContext) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const embeddings = yield* Embeddings;
		const consolidator = yield* Consolidator;
		if (context.clientRef) {
			const existing = yield* repo.getMemoryByClientRef(context.clientRef);
			if (existing) {
				return {
					tag: "duplicate" as const,
					memory: existing,
					idempotent: true,
				} satisfies ExtractedWrite;
			}
		}
		const coerced = coerceTypeKind(extracted.type, extracted.kind);
		const now = Date.now();
		const observedAt = context.observedAt ?? now;
		const eventAt = parseEventAt(extracted.eventAt);
		const vectors = yield* embeddings
			.embed([extracted.text])
			.pipe(
				Effect.catchTag("ProviderUnavailable", () =>
					Effect.succeed<ReadonlyArray<ReadonlyArray<number>>>([]),
				),
			);
		const values = vectors[0];
		const similar = context.dedupe
			? values
				? yield* similarExistingMemories({
						userId: context.userId,
						text: extracted.text,
						values,
						inBatch: context.inBatch,
						inBatchValues: context.inBatchValues,
					})
				: overlapCandidates(
						[...context.inBatch, ...(yield* repo.similarMemoryCandidates([], 50))],
						extracted.text,
					)
			: [];
		const decision: ConsolidateDecision = context.dedupe
			? yield* consolidator.decide(extracted.text, similar)
			: { action: "new", targetId: null, mergedText: null, reason: "dedupe-off" };
		const target = decision.targetId
			? (similar.find((memory) => memory.id === decision.targetId) ??
				(yield* repo.getMemory(decision.targetId).pipe(Effect.orElseSucceed(() => null))))
			: null;

		if (decision.action === "duplicate" && target) {
			return { tag: "duplicate" as const, memory: target } satisfies ExtractedWrite;
		}

		if (decision.action === "merge" && target && decision.mergedText) {
			return {
				tag: "merge" as const,
				target,
				mergedText: decision.mergedText,
				importance: Math.max(target.importance, extracted.importance),
				extracted,
				values,
				sourceId: context.sourceId,
				...(context.chunkId !== undefined ? { chunkId: context.chunkId } : {}),
				...(context.documentId !== undefined ? { documentId: context.documentId } : {}),
			} satisfies ExtractedWrite;
		}

		if (decision.action === "contradicts" && target) {
			const insert: InsertMemoryInput = {
				id: newShortId("m"),
				text: extracted.text,
				kind: coerced.kind,
				type: coerced.type,
				confidence: extracted.confidence * 0.8,
				importance: extracted.importance,
				eventAt,
				validFrom: extracted.validFrom,
				origin: context.origin,
				sourceId: context.sourceId,
				...(context.clientRef !== undefined ? { clientRef: context.clientRef } : {}),
				...(context.documentId !== undefined ? { documentId: context.documentId } : {}),
				...(context.chunkId !== undefined ? { chunkId: context.chunkId } : {}),
				...(context.observedAt !== undefined ? { observedAt: context.observedAt } : {}),
			};
			return {
				tag: "conflict" as const,
				target,
				extracted,
				insert,
				values,
				sourceId: context.sourceId,
				...(context.documentId !== undefined ? { documentId: context.documentId } : {}),
			} satisfies ExtractedWrite;
		}

		let supersedes = decision.action === "supersedes" ? decision.targetId : null;
		let validTo: string | null = null;
		let state: Memory["state"] = "active";
		if (
			supersedes &&
			target &&
			!maySupersede({ observedAt, eventAt }, target, context.documentDate)
		) {
			supersedes = null;
			validTo =
				target.validFrom ??
				(target.observedAt
					? new Date(target.observedAt).toISOString()
					: new Date(observedAt).toISOString());
			state = "superseded";
		}

		const insert: InsertMemoryInput = {
			id: newShortId("m"),
			text: extracted.text,
			kind: coerced.kind,
			type: coerced.type,
			confidence: extracted.confidence,
			importance: extracted.importance,
			eventAt,
			validFrom: extracted.validFrom,
			validTo,
			origin: context.origin,
			sourceId: context.sourceId,
			state,
			...(context.clientRef !== undefined ? { clientRef: context.clientRef } : {}),
			...(context.observedAt !== undefined ? { observedAt: context.observedAt } : {}),
			...(context.documentId !== undefined ? { documentId: context.documentId } : {}),
			...(context.chunkId !== undefined ? { chunkId: context.chunkId } : {}),
		};
		return {
			tag: "insert" as const,
			extracted,
			insert,
			supersedes,
			target,
			values,
			sourceId: context.sourceId,
			...(context.documentId !== undefined ? { documentId: context.documentId } : {}),
			...(context.chunkId !== undefined ? { chunkId: context.chunkId } : {}),
		} satisfies ExtractedWrite;
	});

const upsertMemoryVector = (
	userId: string,
	memory: Memory,
	values: ReadonlyArray<number> | undefined,
	sourceId: string,
	documentId: string,
	now: number,
) =>
	Effect.gen(function* () {
		if (!values || memory.state !== "active") {
			return;
		}
		const index = yield* VectorIndex;
		yield* index
			.upsert([
				{
					id: memoryVectorId(memory.id),
					values,
					namespace: userId,
					metadata: memoryVectorMeta(memory, sourceId, documentId, now),
				},
			])
			.pipe(Effect.catchTag("ProviderUnavailable", () => Effect.void));
	});

export const persistExtractedWrite = (userId: string, write: ExtractedWrite) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const now = Date.now();
		if (write.tag === "duplicate") {
			return write.idempotent
				? { ...toOutcome("duplicate", write.memory), idempotent: true }
				: toOutcome("duplicate", write.memory);
		}
		if (write.tag === "merge") {
			const updated = yield* repo.updateMemory(write.target.id, {
				text: write.mergedText,
				importance: write.importance,
				state: "active",
			});
			yield* repo.insertHistory({
				memoryId: write.target.id,
				text: write.mergedText,
				type: updated.type,
				kind: updated.kind,
				confidence: updated.confidence,
				validFrom: updated.validFrom,
				validTo: updated.validTo,
				state: updated.state,
				reason: "merge",
			});
			const documentId = write.documentId ?? `${write.sourceId}:notes`;
			if (write.chunkId) {
				yield* repo.linkProvenance({
					memoryId: updated.id,
					sourceId: write.sourceId,
					documentId,
					chunkId: write.chunkId,
				});
			}
			yield* upsertMemoryVector(userId, updated, write.values, write.sourceId, documentId, now);
			yield* writeEntities(updated.id, write.extracted, write.values, userId, now);
			return toOutcome("merged", { ...updated, text: write.mergedText }, [write.target.id]);
		}
		if (write.tag === "conflict") {
			yield* repo.updateMemory(write.target.id, { confidence: write.target.confidence * 0.8 });
			const created = yield* repo.insertMemory(userId, write.insert);
			yield* repo.insertEdge(created.id, write.target.id, "contradicts");
			const documentId = write.documentId ?? `${write.sourceId}:notes`;
			yield* upsertMemoryVector(userId, created, write.values, write.sourceId, documentId, now);
			yield* writeEntities(created.id, write.extracted, write.values, userId, now);
			return toOutcome("conflict", created, [write.target.id]);
		}
		const created = yield* repo.insertMemory(userId, write.insert, {
			supersedes: write.supersedes,
		});
		if (write.supersedes) {
			yield* repo.updateMemory(write.supersedes, {
				validTo: new Date(now).toISOString(),
				state: "superseded",
			});
			yield* repo.insertEdge(created.id, write.supersedes, "supersedes");
			yield* repo.insertHistory({
				memoryId: write.supersedes,
				text: write.target?.text ?? "",
				type: write.target?.type ?? created.type,
				kind: write.target?.kind ?? created.kind,
				confidence: write.target?.confidence ?? created.confidence,
				validFrom: write.target?.validFrom ?? null,
				validTo: new Date(now).toISOString(),
				state: "superseded",
				reason: "supersede",
			});
		}
		const documentId = write.documentId ?? `${write.sourceId}:notes`;
		yield* upsertMemoryVector(userId, created, write.values, write.sourceId, documentId, now);
		yield* writeEntities(created.id, write.extracted, write.values, userId, now);
		return toOutcome(
			write.supersedes ? "superseded" : "created",
			created,
			write.supersedes ? [write.supersedes] : [],
		);
	});

export const rememberExtracted = (extracted: ExtractedMemory, context: ExtractedWriteContext) =>
	Effect.gen(function* () {
		const write = yield* planExtractedWrite(extracted, context);
		return yield* persistExtractedWrite(context.userId, write);
	});

export const commitMemoryFromWrite = (
	write: ExtractedWrite,
	chunkId: string,
): CommitMemory | null => {
	if (write.tag !== "insert" && write.tag !== "conflict") {
		return null;
	}
	const insert = write.insert;
	const coerced = coerceTypeKind(
		insert.type ?? write.extracted.type,
		insert.kind ?? write.extracted.kind,
	);
	return {
		id: insert.id ?? newShortId("m"),
		kind: coerced.kind,
		text: insert.text,
		confidence: insert.confidence,
		validFrom: insert.validFrom ?? write.extracted.validFrom,
		validTo: insert.validTo ?? null,
		supersedes: write.tag === "insert" ? write.supersedes : null,
		chunkIds: [chunkId],
		type: coerced.type,
		state: insert.state ?? "active",
		importance: insert.importance ?? insert.confidence,
		eventAt: insert.eventAt ?? parseEventAt(write.extracted.eventAt),
		origin: insert.origin ?? "extracted",
		entities: write.extracted.entities,
		relations: write.extracted.relations,
	};
};

export const plannedMemory = (write: ExtractedWrite): Memory | null => {
	if (write.tag === "duplicate") {
		return write.memory;
	}
	if (write.tag === "merge") {
		return { ...write.target, text: write.mergedText, importance: write.importance };
	}
	const insert = write.insert;
	const coerced = coerceTypeKind(
		insert.type ?? write.extracted.type,
		insert.kind ?? write.extracted.kind,
	);
	return fillFromExtracted(insert.id ?? newShortId("m"), write.extracted, coerced, {
		validTo: insert.validTo ?? null,
		supersedes: write.tag === "insert" ? write.supersedes : null,
		state: insert.state ?? "active",
		origin: insert.origin ?? "extracted",
		eventAt: insert.eventAt ?? parseEventAt(write.extracted.eventAt),
		importance: insert.importance ?? insert.confidence,
		confidence: insert.confidence,
	});
};

export const finalizeIngestWrites = (
	userId: string,
	writes: ReadonlyArray<ExtractedWrite>,
	insertedIds: ReadonlySet<string>,
) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const now = Date.now();
		for (const write of writes) {
			if (write.tag === "duplicate") {
				continue;
			}
			if (write.tag === "merge") {
				yield* persistExtractedWrite(userId, write);
				continue;
			}
			if (write.tag === "conflict") {
				const id = write.insert.id;
				if (id && insertedIds.has(id)) {
					yield* repo.updateMemory(write.target.id, {
						confidence: write.target.confidence * 0.8,
					});
					yield* repo.insertEdge(id, write.target.id, "contradicts");
					const created = yield* repo.getMemory(id);
					const documentId = write.documentId ?? `${write.sourceId}:notes`;
					yield* upsertMemoryVector(userId, created, write.values, write.sourceId, documentId, now);
					yield* writeEntities(id, write.extracted, write.values, userId, now);
					continue;
				}
				yield* persistExtractedWrite(userId, write);
				continue;
			}
			const id = write.insert.id;
			if (id && insertedIds.has(id)) {
				if (write.supersedes) {
					yield* repo.insertHistory({
						memoryId: write.supersedes,
						text: write.target?.text ?? "",
						type: write.target?.type ?? write.extracted.type,
						kind: write.target?.kind ?? write.extracted.kind,
						confidence: write.target?.confidence ?? write.extracted.confidence,
						validFrom: write.target?.validFrom ?? null,
						validTo: new Date(now).toISOString(),
						state: "superseded",
						reason: "supersede",
					});
				}
				const created = yield* repo.getMemory(id);
				const documentId = write.documentId ?? `${write.sourceId}:notes`;
				yield* upsertMemoryVector(userId, created, write.values, write.sourceId, documentId, now);
				yield* writeEntities(id, write.extracted, write.values, userId, now);
			}
		}
	});
