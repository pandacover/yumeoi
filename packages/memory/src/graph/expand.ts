import { Effect } from "effect";
import { MemoryRepo, type RankedId, type SearchFilters } from "../memory-repo.ts";
import { resolveName } from "./resolve.ts";

export const expandSeeds = (seeds: ReadonlyArray<string>, hops: number, asOf: number) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const depth = new Map<string, number>(seeds.map((id) => [id, 0]));
		let frontier = [...seeds];
		for (let hop = 0; hop < hops; hop++) {
			if (frontier.length === 0) {
				break;
			}
			const rels = yield* repo.listRelations(frontier, asOf);
			const next: string[] = [];
			for (const rel of rels) {
				for (const node of [rel.srcEntity, rel.dstEntity]) {
					if (!depth.has(node)) {
						depth.set(node, hop + 1);
						next.push(node);
					}
				}
			}
			frontier = next;
		}
		return [...depth.entries()].map(([id, value]) => ({ id, depth: value }));
	});

export const graphCandidateIds = (input: {
	readonly names: ReadonlyArray<string>;
	readonly namespace: string;
	readonly filters: SearchFilters;
	readonly hops?: number;
}) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const now = Date.now();
		const seeds: string[] = [];
		for (const name of input.names) {
			const resolved = yield* resolveName(name, input.namespace, now, { create: false });
			if (resolved) {
				seeds.push(resolved.id);
			}
		}
		if (seeds.length === 0) {
			return [] as RankedId[];
		}
		const expanded = yield* expandSeeds(seeds, input.hops ?? 2, input.filters.asOf ?? now);
		return yield* repo.listByEntities(
			expanded.map((row) => row.id),
			input.filters,
		);
	});
