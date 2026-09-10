import type { EntityType, ExtractedEntity } from "@yumeoi/domain";
import { ResolveDecision, resolveDecisionJsonSchema } from "@yumeoi/domain";
import { Effect } from "effect";
import { cosineSimilarity } from "../cosine.ts";
import { Embeddings } from "../embeddings.ts";
import { Llm } from "../llm.ts";
import { MemoryRepo } from "../memory-repo.ts";
import { VectorIndex } from "../vector-index.ts";
import { canonicalName } from "./names.ts";

const PERSON_EMBED_MERGE = 0.9;

export type ResolvedEntity = {
	readonly id: string;
	readonly name: string;
	readonly type: EntityType;
	readonly created: boolean;
};

const llmConfirmSame = (left: string, right: string) =>
	Effect.gen(function* () {
		const llm = yield* Llm;
		const decision = yield* llm
			.structured({
				job: "resolve",
				schema: ResolveDecision,
				schemaName: "resolve_decision",
				jsonSchema: resolveDecisionJsonSchema(),
				system: "Decide if two mentions are the same entity. False merges are worse than misses.",
				user: `A: ${left}\nB: ${right}`,
			})
			.pipe(Effect.orElseSucceed(() => ({ same: false, reason: "resolve-unavailable" })));
		return decision.same;
	});

export const resolveEntity = (input: {
	readonly mention: ExtractedEntity;
	readonly namespace: string;
	readonly now: number;
	readonly values?: ReadonlyArray<number>;
}) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const canonical = canonicalName(input.mention.name);
		const exact = yield* repo.findEntity(canonical, input.mention.type);
		if (exact) {
			return { id: exact.id, name: exact.name, type: input.mention.type, created: false };
		}
		const aliased = yield* repo.findEntityByAlias(canonical);
		if (aliased && aliased.type === input.mention.type) {
			return { id: aliased.id, name: aliased.name, type: input.mention.type, created: false };
		}
		if (input.values && input.values.length > 0 && input.mention.type !== "person") {
			const index = yield* VectorIndex;
			const hits = yield* index
				.query({
					values: input.values,
					namespace: input.namespace,
					topK: 8,
					filter: { kind: "entity", type: input.mention.type },
				})
				.pipe(Effect.catchTag("ProviderUnavailable", () => Effect.succeed([])));
			const embeddings = yield* Embeddings;
			for (const hit of hits) {
				if (!hit.id.startsWith("e:")) {
					continue;
				}
				const entityId = hit.id.slice(2);
				const found = yield* repo.getEntity(entityId);
				if (!found) {
					continue;
				}
				const [candidateValues] = yield* embeddings
					.embed([found.name])
					.pipe(
						Effect.catchTag("ProviderUnavailable", () =>
							Effect.succeed<ReadonlyArray<ReadonlyArray<number>>>([]),
						),
					);
				const score = candidateValues ? cosineSimilarity(input.values, candidateValues) : hit.score;
				if (score >= PERSON_EMBED_MERGE) {
					yield* repo.putAlias(canonical, found.id);
					return { id: found.id, name: found.name, type: input.mention.type, created: false };
				}
				if (score >= 0.8 && (input.mention.type === "org" || input.mention.type === "project")) {
					const same = yield* llmConfirmSame(input.mention.name, found.name);
					if (same) {
						yield* repo.putAlias(canonical, found.id);
						return { id: found.id, name: found.name, type: input.mention.type, created: false };
					}
				}
			}
		}
		const upserted = yield* repo.upsertEntity({
			name: input.mention.name,
			canonical,
			type: input.mention.type,
			now: input.now,
		});
		yield* repo.putAlias(canonical, upserted.id);
		return { id: upserted.id, name: input.mention.name, type: input.mention.type, created: true };
	});

export const resolveName = (
	name: string,
	namespace: string,
	now: number,
	options?: { readonly create?: boolean },
) =>
	Effect.gen(function* () {
		if (options?.create === false) {
			const repo = yield* MemoryRepo;
			const canonical = canonicalName(name);
			const type = /^[A-Z][a-z]+$/.test(name) ? ("person" as const) : ("other" as const);
			const exact = yield* repo.findEntity(canonical, type);
			if (exact) {
				return { id: exact.id, name: exact.name, type, created: false };
			}
			const aliased = yield* repo.findEntityByAlias(canonical);
			if (aliased) {
				return { id: aliased.id, name: aliased.name, type: aliased.type, created: false };
			}
			const anyType = yield* repo.findEntity(canonical);
			if (anyType) {
				return { id: anyType.id, name: anyType.name, type: anyType.type, created: false };
			}
			return null;
		}
		return yield* resolveEntity({
			mention: {
				name,
				type: /^[A-Z][a-z]+$/.test(name) ? "person" : "other",
			},
			namespace,
			now,
		});
	});
