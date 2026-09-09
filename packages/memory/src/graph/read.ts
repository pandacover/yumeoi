import { Effect } from "effect";
import { MemoryRepo } from "../memory-repo.ts";
import { expandSeeds } from "./expand.ts";
import { resolveName } from "./resolve.ts";

export const getEntityView = (input: {
	readonly namespace: string;
	readonly name?: string;
	readonly id?: string;
	readonly hops?: number;
}) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		let entity = input.id ? yield* repo.getEntity(input.id) : null;
		if (!entity && input.name) {
			const resolved = yield* resolveName(input.name, input.namespace, Date.now(), {
				create: false,
			});
			if (resolved) {
				entity = yield* repo.getEntity(resolved.id);
			}
		}
		if (!entity) {
			return null;
		}
		const hops = Math.min(Math.max(input.hops ?? 1, 0), 2);
		const expanded = yield* expandSeeds([entity.id], hops, Date.now());
		const relations = yield* repo.listRelations(expanded.map((row) => row.id));
		const memories = yield* repo.listEntityMemories(entity.id, 20);
		return { entity, relations, memories, hops };
	});

export const listEntityIndex = () =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const entities = yield* repo.listEntities();
		return entities
			.map(
				(entity) =>
					`- ${entity.name} (${entity.type}${entity.description ? `: ${entity.description}` : ""})`,
			)
			.join("\n");
	});
