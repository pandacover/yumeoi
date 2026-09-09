import type { ExtractedEntity, ExtractedRelation } from "@yumeoi/domain";
import { SummaryResult, summaryResultJsonSchema } from "@yumeoi/domain";
import { Effect } from "effect";
import { Llm } from "../llm.ts";
import { MemoryRepo } from "../memory-repo.ts";
import { VectorIndex } from "../vector-index.ts";
import { resolveEntity } from "./resolve.ts";

const SUMMARY_COUNTS = new Set([3, 10, 30]);

const maybeSummarize = (entityId: string) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const entity = yield* repo.getEntity(entityId);
		if (!entity || !SUMMARY_COUNTS.has(entity.mentionCount)) {
			return;
		}
		const memories = yield* repo.listEntityMemories(entityId, 20);
		const llm = yield* Llm;
		const summary = yield* llm
			.structured({
				job: "summarize",
				schema: SummaryResult,
				schemaName: "summary",
				jsonSchema: summaryResultJsonSchema(),
				system: "Summarize this entity from its memories in one or two sentences.",
				user: `${entity.name} (${entity.type})\n${memories.map((memory) => memory.text).join("\n")}`,
			})
			.pipe(
				Effect.orElseSucceed(() => ({
					text: memories
						.slice(0, 3)
						.map((memory) => memory.text)
						.join(" ")
						.slice(0, 400),
				})),
			);
		yield* repo.setEntityDescription(entityId, summary.text.slice(0, 400));
	});

export const writeGraphForMemory = (input: {
	readonly memoryId: string;
	readonly userId: string;
	readonly now: number;
	readonly entities: ReadonlyArray<ExtractedEntity>;
	readonly relations: ReadonlyArray<ExtractedRelation>;
	readonly values?: ReadonlyArray<number>;
	readonly validFrom?: string | null;
}) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const index = yield* VectorIndex;
		const resolved = new Map<string, string>();
		for (const entity of input.entities) {
			const item = yield* resolveEntity({
				mention: entity,
				namespace: input.userId,
				now: input.now,
				...(input.values ? { values: input.values } : {}),
			});
			resolved.set(entity.name.toLowerCase(), item.id);
			yield* repo.linkMemoryEntity(input.memoryId, item.id, "mention");
			if (input.values) {
				yield* index
					.upsert([
						{
							id: `e:${item.id}`,
							values: input.values,
							namespace: input.userId,
							metadata: { sourceId: "entity", kind: "entity", type: entity.type, ts: input.now },
						},
					])
					.pipe(Effect.catchTag("ProviderUnavailable", () => Effect.void));
			}
			yield* maybeSummarize(item.id);
		}
		const resolveLocal = (name: string) => resolved.get(name.toLowerCase());
		for (const relation of input.relations) {
			const src = resolveLocal(relation.subject);
			const dst = resolveLocal(relation.object);
			if (!src || !dst || src === dst) {
				continue;
			}
			yield* repo.upsertRelation({
				srcEntity: src,
				dstEntity: dst,
				predicate: relation.predicate,
				memoryId: input.memoryId,
				validFrom: input.validFrom ?? null,
				confidence: 0.8,
				now: input.now,
			});
			yield* repo.linkMemoryEntity(input.memoryId, src, "subject");
			yield* repo.linkMemoryEntity(input.memoryId, dst, "object");
		}
	});
