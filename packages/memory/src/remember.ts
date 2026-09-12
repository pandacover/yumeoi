export { canonicalName } from "./graph/names.ts";
export { maySupersede, parseEventAt } from "./write-extracted.ts";

import type {
	AddMemoryRequest,
	ExtractedEntity,
	ExtractedMemory,
	Memory,
	RememberOutcomeItem,
} from "@yumeoi/domain";
import { defaultTypeForKind, fillMemory } from "@yumeoi/domain";
import { Effect } from "effect";
import { classifyStatement } from "./classify.ts";
import { Extractor } from "./extractor.ts";
import { extractMentions, extractRelations } from "./graph/names.ts";
import { newShortId } from "./ids.ts";
import { MemoryRepo } from "./memory-repo.ts";
import { coerceTypeKind } from "./types.ts";
import { type ExtractedWriteContext, rememberExtracted } from "./write-extracted.ts";

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
	readonly origin?: Memory["origin"];
	readonly observedAt?: number | null;
	readonly documentId?: string;
	readonly chunkId?: string;
};

const withGraph = (item: ExtractedMemory): ExtractedMemory => {
	if (item.entities.length > 0) {
		return item;
	}
	const mentions = extractMentions(item.text);
	return {
		...item,
		entities: mentions,
		relations: extractRelations(item.text, mentions),
	};
};

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
				if (item.type && item.kind) {
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
				} else {
					const classified = yield* classifyStatement(item.text);
					items.push({
						...classified,
						text: item.text,
						importance: item.importance ?? classified.importance,
						eventAt: item.eventAt ?? classified.eventAt,
						validFrom: item.validFrom ?? classified.validFrom,
						entities: item.entities ?? classified.entities,
					});
				}
			}
		} else if (params.text) {
			const classified = yield* classifyStatement(params.text);
			items.push(classified);
		}

		const known: Memory[] = [];
		const knownValues = new Map<string, ReadonlyArray<number>>();
		const outcomes: RememberOutcomeItem[] = [];
		for (const [index, extracted] of items.map(withGraph).entries()) {
			const clientRef = params.items?.[index]?.clientRef;
			const context: ExtractedWriteContext = {
				userId: params.userId,
				sourceId,
				origin: params.origin ?? "agent",
				documentDate,
				dedupe,
				inBatch: known,
				inBatchValues: knownValues,
				...(clientRef ? { clientRef } : {}),
				...(params.observedAt !== undefined ? { observedAt: params.observedAt } : {}),
				...(params.documentId !== undefined ? { documentId: params.documentId } : {}),
				...(params.chunkId !== undefined ? { chunkId: params.chunkId } : {}),
			};
			const outcome = yield* rememberExtracted(extracted, context);
			outcomes.push(outcome);
			const repo = yield* MemoryRepo;
			const stored = yield* repo.getMemory(outcome.id).pipe(Effect.orElseSucceed(() => null));
			if (stored) {
				known.push(stored);
			}
		}
		return { items: outcomes };
	});

export const addMemory = (userId: string, input: AddMemoryRequest) =>
	Effect.gen(function* () {
		const kind = input.kind;
		const type = input.type ?? defaultTypeForKind(kind);
		const outcome = yield* remember({
			userId,
			items: [
				{
					text: input.text,
					kind,
					type,
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
