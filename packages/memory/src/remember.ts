import type {
	AddMemoryRequest,
	ExtractedEntity,
	ExtractedMemory,
	Memory,
	RememberOutcomeItem,
} from "@yumeoi/domain";
import { fillMemory } from "@yumeoi/domain";
import { Effect } from "effect";
import { classifyStatement } from "./classify.ts";
import { Consolidator } from "./consolidator.ts";
import { Embeddings } from "./embeddings.ts";
import { Extractor } from "./extractor.ts";
import { newShortId } from "./ids.ts";
import { overlapCandidates, similarExistingMemories } from "./ingest.ts";
import { type InsertMemoryInput, MemoryRepo } from "./memory-repo.ts";
import { memoryVectorId } from "./recall.ts";
import { coerceTypeKind } from "./types.ts";
import { VALID_TO_SENTINEL, VectorIndex } from "./vector-index.ts";

export const canonicalName = (name: string): string =>
	name
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/^(the|a|an|mr|ms|mrs|dr)\s+/u, "")
		.trim();

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

const memoryVectorMeta = (memory: Memory, sourceId: string, documentId: string, ts: number) => ({
	sourceId,
	documentId,
	kind: memory.kind,
	type: memory.type,
	state: memory.state,
	ts,
	eventAt: memory.eventAt ?? memory.observedAt ?? ts,
	validTo: memory.validTo ? Date.parse(memory.validTo) || VALID_TO_SENTINEL : VALID_TO_SENTINEL,
});

const writeEntities = (
	memoryId: string,
	entities: ReadonlyArray<ExtractedEntity>,
	values: ReadonlyArray<number> | undefined,
	userId: string,
	now: number,
) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const index = yield* VectorIndex;
		for (const entity of entities) {
			const upserted = yield* repo.upsertEntity({
				name: entity.name,
				canonical: canonicalName(entity.name),
				type: entity.type,
				now,
			});
			yield* repo.linkMemoryEntity(memoryId, upserted.id, "mention");
			if (values) {
				yield* index
					.upsert([
						{
							id: `e:${upserted.id}`,
							values,
							namespace: userId,
							metadata: { sourceId: "entity", kind: "entity", type: entity.type, ts: now },
						},
					])
					.pipe(Effect.catchTag("ProviderUnavailable", () => Effect.void));
			}
		}
	});

const toOutcome = (
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

export type RememberParams = {
	readonly userId: string;
	readonly text?: string;
	readonly items?: ReadonlyArray<{
		readonly text: string;
		readonly type?: ExtractedMemory["type"];
		readonly kind?: ExtractedMemory["kind"];
		readonly importance?: number;
		readonly eventAt?: string | null;
		readonly validFrom?: string | null;
		readonly clientRef?: string;
		readonly confidence?: number;
		readonly entities?: ReadonlyArray<ExtractedEntity>;
	}>;
	readonly mode?: "extract" | "verbatim";
	readonly sourceId?: string;
	readonly dedupe?: boolean;
	readonly documentDate?: number | null;
};

const rememberOne = (params: {
	readonly userId: string;
	readonly sourceId: string;
	readonly extracted: ExtractedMemory;
	readonly clientRef?: string;
	readonly origin: Memory["origin"];
	readonly documentDate: number | null;
	readonly dedupe: boolean;
}) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const embeddings = yield* Embeddings;
		const index = yield* VectorIndex;
		const consolidator = yield* Consolidator;
		if (params.clientRef) {
			const existing = yield* repo.getMemoryByClientRef(params.clientRef);
			if (existing) {
				return toOutcome("duplicate", existing);
			}
		}
		const coerced = coerceTypeKind(params.extracted.type, params.extracted.kind);
		const now = Date.now();
		const eventAt = parseEventAt(params.extracted.eventAt);
		const vectors = yield* embeddings
			.embed([params.extracted.text])
			.pipe(
				Effect.catchTag("ProviderUnavailable", () =>
					Effect.succeed<ReadonlyArray<ReadonlyArray<number>>>([]),
				),
			);
		const values = vectors[0];
		const similar = params.dedupe
			? values
				? yield* similarExistingMemories({
						userId: params.userId,
						text: params.extracted.text,
						values,
						inBatch: [],
						inBatchValues: new Map(),
					})
				: overlapCandidates(yield* repo.similarMemoryCandidates([], 50), params.extracted.text)
			: [];
		const decision = params.dedupe
			? yield* consolidator.decide(params.extracted.text, similar)
			: { action: "new" as const, targetId: null, mergedText: null, reason: "dedupe-off" };
		const target = decision.targetId
			? (similar.find((memory) => memory.id === decision.targetId) ??
				(yield* repo.getMemory(decision.targetId).pipe(Effect.orElseSucceed(() => null))))
			: null;

		if (decision.action === "duplicate" && target) {
			return toOutcome("duplicate", target);
		}

		if (decision.action === "merge" && target && decision.mergedText) {
			const updated = yield* repo.updateMemory(target.id, {
				text: decision.mergedText,
				importance: Math.max(target.importance, params.extracted.importance),
			});
			yield* repo.insertHistory({
				memoryId: target.id,
				text: decision.mergedText,
				type: updated.type,
				kind: updated.kind,
				confidence: updated.confidence,
				validFrom: updated.validFrom,
				validTo: updated.validTo,
				state: updated.state,
				reason: "merge",
			});
			if (values) {
				yield* index
					.upsert([
						{
							id: memoryVectorId(updated.id),
							values,
							namespace: params.userId,
							metadata: memoryVectorMeta(updated, params.sourceId, `${params.sourceId}:notes`, now),
						},
					])
					.pipe(Effect.catchTag("ProviderUnavailable", () => Effect.void));
			}
			return toOutcome("merged", updated, [target.id]);
		}

		if (decision.action === "contradicts" && target) {
			yield* repo.updateMemory(target.id, { confidence: target.confidence * 0.8 });
			const insert: InsertMemoryInput = {
				text: params.extracted.text,
				kind: coerced.kind,
				type: coerced.type,
				confidence: params.extracted.confidence * 0.8,
				importance: params.extracted.importance,
				eventAt,
				validFrom: params.extracted.validFrom,
				origin: params.origin,
				sourceId: params.sourceId,
				clientRef: params.clientRef,
			};
			const created = yield* repo.insertMemory(params.userId, insert);
			yield* repo.insertEdge(created.id, target.id, "contradicts");
			if (values) {
				yield* index
					.upsert([
						{
							id: memoryVectorId(created.id),
							values,
							namespace: params.userId,
							metadata: memoryVectorMeta(created, params.sourceId, `${params.sourceId}:notes`, now),
						},
					])
					.pipe(Effect.catchTag("ProviderUnavailable", () => Effect.void));
			}
			yield* writeEntities(created.id, params.extracted.entities, values, params.userId, now);
			return toOutcome("conflict", created, [target.id]);
		}

		let supersedes = decision.action === "supersedes" ? decision.targetId : null;
		let validTo: string | null = null;
		let state: Memory["state"] = "active";
		if (
			supersedes &&
			target &&
			!maySupersede({ observedAt: now, eventAt }, target, params.documentDate)
		) {
			supersedes = null;
			validTo =
				target.validFrom ??
				(target.observedAt
					? new Date(target.observedAt).toISOString()
					: new Date(now).toISOString());
			state = "superseded";
		}

		const created = yield* repo.insertMemory(
			params.userId,
			{
				id: newShortId("m"),
				text: params.extracted.text,
				kind: coerced.kind,
				type: coerced.type,
				confidence: params.extracted.confidence,
				importance: params.extracted.importance,
				eventAt,
				validFrom: params.extracted.validFrom,
				validTo,
				origin: params.origin,
				sourceId: params.sourceId,
				clientRef: params.clientRef,
				state,
			},
			{ supersedes },
		);
		if (supersedes) {
			yield* repo.updateMemory(supersedes, {
				validTo: new Date(now).toISOString(),
				state: "superseded",
			});
			yield* repo.insertEdge(created.id, supersedes, "supersedes");
			yield* repo.insertHistory({
				memoryId: supersedes,
				text: target?.text ?? "",
				type: target?.type ?? created.type,
				kind: target?.kind ?? created.kind,
				confidence: target?.confidence ?? created.confidence,
				validFrom: target?.validFrom ?? null,
				validTo: new Date(now).toISOString(),
				state: "superseded",
				reason: "supersede",
			});
		}
		if (values && created.state === "active") {
			yield* index
				.upsert([
					{
						id: memoryVectorId(created.id),
						values,
						namespace: params.userId,
						metadata: memoryVectorMeta(created, params.sourceId, `${params.sourceId}:notes`, now),
					},
				])
				.pipe(Effect.catchTag("ProviderUnavailable", () => Effect.void));
		}
		yield* writeEntities(created.id, params.extracted.entities, values, params.userId, now);
		return toOutcome(
			supersedes ? "superseded" : "created",
			created,
			supersedes ? [supersedes] : [],
		);
	});

export const remember = (params: RememberParams) =>
	Effect.gen(function* () {
		const sourceId = params.sourceId ?? `agent:${params.userId}`;
		const dedupe = params.dedupe ?? true;
		const documentDate = params.documentDate ?? null;
		const items: ExtractedMemory[] = [];
		if (params.mode === "extract" && params.text) {
			const extractor = yield* Extractor;
			items.push(...(yield* extractor.extract(params.text, "remember")));
		} else if (params.items && params.items.length > 0) {
			for (const item of params.items) {
				if (!item.type || !item.kind) {
					const classified = yield* classifyStatement(item.text);
					items.push({
						...classified,
						text: item.text,
						importance: item.importance ?? classified.importance,
						eventAt: item.eventAt ?? classified.eventAt,
						validFrom: item.validFrom ?? classified.validFrom,
						entities: item.entities ?? classified.entities,
					});
				} else {
					const coerced = coerceTypeKind(item.type, item.kind);
					items.push({
						type: coerced.type,
						kind: coerced.kind,
						text: item.text,
						confidence: item.confidence ?? 0.9,
						importance: item.importance ?? item.confidence ?? 0.9,
						eventAt: item.eventAt ?? null,
						validFrom: item.validFrom ?? null,
						entities: item.entities ?? [],
						relations: [],
					});
				}
			}
		} else if (params.text) {
			const classified = yield* classifyStatement(params.text);
			items.push(classified);
		}

		const outcomes: RememberOutcomeItem[] = [];
		for (const [index, extracted] of items.entries()) {
			const clientRef = params.items?.[index]?.clientRef;
			outcomes.push(
				yield* rememberOne({
					userId: params.userId,
					sourceId,
					extracted,
					...(clientRef ? { clientRef } : {}),
					origin: "agent",
					documentDate,
					dedupe,
				}),
			);
		}
		return { items: outcomes };
	});

export const addMemory = (userId: string, input: AddMemoryRequest) =>
	Effect.gen(function* () {
		const outcome = yield* remember({
			userId,
			items: [
				{
					text: input.text,
					kind: input.kind,
					...(input.type ? { type: input.type } : {}),
					confidence: input.confidence,
					importance: input.confidence,
					...(input.clientRef ? { clientRef: input.clientRef } : {}),
				},
			],
			mode: "verbatim",
			sourceId: input.sourceId ?? `agent:${userId}`,
		});
		const first = outcome.items[0];
		if (!first) {
			return fillMemory({
				id: newShortId("m"),
				kind: input.kind,
				text: input.text,
				confidence: input.confidence,
				validFrom: null,
				validTo: null,
				supersedes: null,
				origin: "agent",
			});
		}
		return yield* Effect.flatMap(MemoryRepo, (repo) => repo.getMemory(first.id));
	});
