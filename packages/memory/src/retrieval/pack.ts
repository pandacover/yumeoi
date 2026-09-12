import type {
	Chunk,
	ChunkHit,
	GraphRelationLine,
	Memory,
	MemoryHit,
	Provenance,
	RecallResult,
	WhyFlag,
} from "@yumeoi/domain";
import { packMarkdown } from "../format.ts";
import { orderProvenanceForOrigin } from "../provenance.ts";
import { isSemanticStale } from "../retention.ts";
import { estimateTokens } from "../rrf.ts";

export const packRecall = (input: {
	readonly memories: ReadonlyArray<Memory>;
	readonly scores: Map<string, number>;
	readonly why: ReadonlyMap<string, ReadonlyArray<WhyFlag>>;
	readonly provenance: ReadonlyArray<Provenance & { readonly memoryId: string }>;
	readonly chunks: ReadonlyArray<Chunk>;
	readonly chunkScores: Map<string, number>;
	readonly chunkMeta: ReadonlyArray<{
		readonly chunkId: string;
		readonly sourceId: string;
		readonly title: string;
		readonly url: string | null;
	}>;
	readonly budgetTokens: number;
	readonly includeEvidence: boolean;
	readonly conflicts: ReadonlyArray<{ readonly src: string; readonly dst: string }>;
	readonly format: "markdown" | "json";
	readonly relations?: ReadonlyArray<GraphRelationLine>;
	readonly now?: number;
	readonly scoreFloorRatio?: number;
	readonly minPackScore?: number;
}): RecallResult => {
	const provenanceByMemory = new Map<string, Provenance[]>();
	for (const row of input.provenance) {
		const { memoryId, ...rest } = row;
		const list = provenanceByMemory.get(memoryId) ?? [];
		list.push(rest);
		provenanceByMemory.set(memoryId, list);
	}

	const rankedMemories = [...input.memories]
		.sort((a, b) => (input.scores.get(b.id) ?? 0) - (input.scores.get(a.id) ?? 0))
		.map((memory): MemoryHit => {
			const stale = isSemanticStale(memory, input.now ?? Date.now());
			return {
				memory,
				score: input.scores.get(memory.id) ?? 0,
				provenance: orderProvenanceForOrigin(
					memory.origin,
					provenanceByMemory.get(memory.id) ?? [],
				),
				why: [...(input.why.get(memory.id) ?? [])],
				...(stale ? { stale: true } : {}),
			};
		});

	const packedMemories: MemoryHit[] = [];
	let used = 0;
	const maxScore = rankedMemories[0]?.score ?? 0;
	const floor = Math.max(input.minPackScore ?? 0, maxScore * (input.scoreFloorRatio ?? 0));
	for (const hit of rankedMemories) {
		if (hit.score < floor) {
			break;
		}
		const cost = estimateTokens(hit.memory.text);
		if (used + cost > input.budgetTokens) {
			break;
		}
		packedMemories.push(hit);
		used += cost;
	}

	const citedDocuments = new Set(
		packedMemories.flatMap((hit) => hit.provenance.map((row) => row.documentId)),
	);
	const metaById = new Map(input.chunkMeta.map((row) => [row.chunkId, row]));
	const chunkById = new Map(input.chunks.map((chunk) => [chunk.id, chunk]));
	const packedChunks: ChunkHit[] = [];
	if (input.includeEvidence) {
		const rankedChunks = [...input.chunkScores.entries()].sort((a, b) => b[1] - a[1]);
		for (const [id, score] of rankedChunks) {
			const chunk = chunkById.get(id);
			const meta = metaById.get(id);
			if (!chunk || !meta) {
				continue;
			}
			if (citedDocuments.has(chunk.documentId) && packedChunks.length > 0) {
				continue;
			}
			const cost = estimateTokens(chunk.text);
			if (used + cost > input.budgetTokens) {
				break;
			}
			packedChunks.push({
				chunk,
				score,
				title: meta.title,
				url: meta.url,
				sourceId: meta.sourceId,
			});
			citedDocuments.add(chunk.documentId);
			used += cost;
		}
	}

	const relations = input.relations ?? [];
	const markdown = packMarkdown({
		memories: packedMemories,
		chunks: packedChunks,
		conflicts: input.conflicts,
		relations,
	});
	return {
		memories: packedMemories,
		chunks: packedChunks,
		...(relations.length > 0 ? { relations } : {}),
		...(input.format === "json" ? {} : { markdown }),
	};
};
