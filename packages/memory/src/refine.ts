import {
	type ExtractedMemory,
	type Memory,
	type MemoryOrigin,
	SummaryResult,
	summaryResultJsonSchema,
} from "@yumeoi/domain";
import { Effect } from "effect";
import { nowMillis } from "./clock.ts";
import { Extractor } from "./extractor.ts";
import { extractMentions, extractRelations } from "./graph/names.ts";
import { writeGraphForMemory } from "./graph/write.ts";
import { Llm } from "./llm.ts";
import { MemoryRepo } from "./memory-repo.ts";
import { orderProvenanceForOrigin, rewriteCitationOrigin } from "./provenance.ts";
import { normalizeMemoryText } from "./retention.ts";
import { reembedMemory } from "./write-extracted.ts";

export type RefineAction = "scored" | "rewritten" | "reextracted";

const tokenOverlap = (left: string, right: string): number => {
	const tokens = (text: string) =>
		new Set(
			text
				.toLowerCase()
				.split(/\W+/u)
				.filter((token) => token.length > 2),
		);
	const a = tokens(left);
	const b = tokens(right);
	let n = 0;
	for (const token of a) {
		if (b.has(token)) {
			n += 1;
		}
	}
	return n;
};

const pickExtracted = (
	extracted: ReadonlyArray<ExtractedMemory>,
	current: Memory,
	query?: string,
): ExtractedMemory | null => {
	const candidates = extracted.filter(
		(item) => normalizeMemoryText(item.text) !== normalizeMemoryText(current.text),
	);
	if (candidates.length === 0) {
		return null;
	}
	const needle = query ?? current.text;
	return (
		[...candidates].sort(
			(left, right) => tokenOverlap(right.text, needle) - tokenOverlap(left.text, needle),
		)[0] ?? null
	);
};

export const applyMemoryText = (input: {
	readonly memory: Memory;
	readonly text: string;
	readonly namespace: string;
	readonly reason: string;
	readonly origin?: MemoryOrigin;
}) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const now = yield* nowMillis;
		const origin = input.origin ?? input.memory.origin;
		const updated = yield* repo.updateMemory(input.memory.id, {
			text: input.text,
			state: "active",
			...(origin !== input.memory.origin ? { origin } : {}),
		});
		yield* repo.insertHistory({
			memoryId: updated.id,
			text: updated.text,
			type: updated.type,
			kind: updated.kind,
			confidence: updated.confidence,
			validFrom: updated.validFrom,
			validTo: updated.validTo,
			state: updated.state,
			reason: input.reason,
			changedAt: now,
		});
		if (origin !== "extracted") {
			yield* repo.ensureLinkedProvenance({
				userId: input.namespace,
				memoryId: updated.id,
				sourceId: `agent:${input.namespace}`,
				text: updated.text,
			});
		}
		const provenance = yield* repo.provenanceFor([updated.id]);
		const ordered = orderProvenanceForOrigin(
			origin,
			provenance.map(({ memoryId: _id, ...rest }) => rest),
		);
		const first =
			origin === "extracted"
				? ordered[0]
				: (ordered.find((row) => row.sourceId.startsWith("agent")) ?? ordered[0]);
		yield* reembedMemory({
			userId: input.namespace,
			memory: { ...updated, origin },
			...(first?.sourceId ? { sourceId: first.sourceId } : {}),
			...(first?.documentId ? { documentId: first.documentId } : {}),
		});
		const mentions = extractMentions(updated.text);
		yield* writeGraphForMemory({
			memoryId: updated.id,
			userId: input.namespace,
			now,
			entities: mentions,
			relations: extractRelations(updated.text, mentions),
		});
		return { ...updated, origin };
	});

const rewriteFromNote = (memory: Memory, note: string, query?: string) =>
	Effect.gen(function* () {
		const llm = yield* Llm;
		const summary = yield* llm
			.structured({
				job: "summarize",
				schema: SummaryResult,
				schemaName: "summary",
				jsonSchema: summaryResultJsonSchema(),
				system:
					"Rewrite the memory using the correction. Keep facts that remain true. One or two sentences. Do not mention the correction itself.",
				user: [
					`Current:\n${memory.text}`,
					`Correction:\n${note}`,
					query ? `Query that missed:\n${query}` : "",
				]
					.filter(Boolean)
					.join("\n\n"),
			})
			.pipe(Effect.orElseSucceed(() => ({ text: note.trim() })));
		const text = summary.text.trim();
		if (text.length === 0 || normalizeMemoryText(text) === normalizeMemoryText(memory.text)) {
			return null;
		}
		return text.slice(0, 400);
	});

const reextractFromProvenance = (memory: Memory, query?: string) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const provenance = yield* repo.provenanceFor([memory.id]);
		if (provenance.length === 0) {
			return null;
		}
		const extractor = yield* Extractor;
		let best: ExtractedMemory | null = null;
		for (const row of provenance) {
			const chunk = yield* repo.getChunk(row.chunkId).pipe(Effect.orElseSucceed(() => null));
			if (!chunk) {
				continue;
			}
			const extracted = yield* extractor
				.extract(chunk.text, row.title)
				.pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<ExtractedMemory>));
			const picked = pickExtracted(extracted, memory, query);
			if (
				picked &&
				(!best ||
					tokenOverlap(picked.text, query ?? chunk.text) >
						tokenOverlap(best.text, query ?? chunk.text))
			) {
				best = picked;
			}
		}
		return best?.text ?? null;
	});

export const refineMemoryFromUse = (input: {
	readonly memory: Memory;
	readonly namespace: string;
	readonly note?: string;
	readonly query?: string;
}) =>
	Effect.gen(function* () {
		if (input.note && input.note.trim().length > 0) {
			const rewritten = yield* rewriteFromNote(input.memory, input.note.trim(), input.query);
			if (rewritten) {
				const memory = yield* applyMemoryText({
					memory: input.memory,
					text: rewritten,
					namespace: input.namespace,
					reason: "refine",
					origin: rewriteCitationOrigin(input.memory.origin),
				});
				return { action: "rewritten" as const, memory };
			}
		}
		const reextracted = yield* reextractFromProvenance(input.memory, input.query);
		if (reextracted) {
			const memory = yield* applyMemoryText({
				memory: input.memory,
				text: reextracted,
				namespace: input.namespace,
				reason: "refine",
				origin: "extracted",
			});
			return { action: "reextracted" as const, memory };
		}
		return { action: "scored" as const, memory: input.memory };
	});
