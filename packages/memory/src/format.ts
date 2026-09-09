import type { ChunkHit, Memory, MemoryHit, WhyFlag } from "@yumeoi/domain";
import { estimateTokens } from "./rrf.ts";

const isoDate = (ms: number | null | undefined): string | null => {
	if (ms == null || !Number.isFinite(ms)) {
		return null;
	}
	return new Date(ms).toISOString().slice(0, 10);
};

const whyText = (why: ReadonlyArray<WhyFlag> | undefined): string => {
	if (!why || why.length === 0) {
		return "";
	}
	return ` — why: ${why.join("+")}`;
};

export const formatMemoryLine = (
	index: number,
	hit: MemoryHit,
	options?: { readonly conflictWith?: number },
): string => {
	const memory = hit.memory;
	const src = hit.provenance[0];
	const srcBit = src ? `, src ${src.title ? JSON.stringify(src.title) : src.sourceId}` : "";
	const seen = isoDate(memory.eventAt ?? memory.observedAt);
	const conf = memory.confidence.toFixed(2).replace(/^0/, "");
	const eventPrefix =
		memory.type === "episodic" && seen ? `${seen} ` : seen ? `seen ${seen}, ` : "";
	const meta =
		memory.type === "episodic"
			? `(${memory.type}·${memory.kind}, conf ${conf}${srcBit})`
			: `(${memory.type}·${memory.kind}, conf ${conf}, ${eventPrefix.replace(/, $/, "")}${srcBit})`;
	const conflict = options?.conflictWith ? ` ⚠ conflicts with [${options.conflictWith}]` : "";
	const line =
		memory.type === "episodic"
			? `[${index}] ${eventPrefix}${meta} ${memory.text}.${whyText(hit.why)}${conflict}`
			: `[${index}] ${meta} ${memory.text}${whyText(hit.why)}${conflict}`;
	return line.replaceAll("..", ".");
};

export const formatChunkLine = (index: number, hit: ChunkHit): string =>
	`[${index}] (evidence, src ${JSON.stringify(hit.title)}) ${hit.chunk.text.slice(0, 240)}`;

export const formatRelationLine = (
	index: number,
	line: {
		readonly src: string;
		readonly predicate: string;
		readonly dst: string;
		readonly since: string | null;
	},
	evidenceIndex?: number,
): string => {
	const since = line.since ? ` (since ${line.since.slice(0, 7)}` : "";
	const cite = evidenceIndex ? ` [${evidenceIndex}]` : "";
	return `[${index}] ${line.src} —${line.predicate}→ ${line.dst}${since}${since ? ")" : ""}${cite}`;
};

export const formatIdFooter = (
	entries: ReadonlyArray<{ readonly id: string; readonly index: number }>,
): string => {
	if (entries.length === 0) {
		return "";
	}
	return `ids: ${entries.map((entry) => `${entry.id}=[${entry.index}]`).join(", ")}`;
};

export const packMarkdown = (input: {
	readonly memories: ReadonlyArray<MemoryHit>;
	readonly chunks: ReadonlyArray<ChunkHit>;
	readonly conflicts?: ReadonlyArray<{ readonly src: string; readonly dst: string }>;
	readonly relations?: ReadonlyArray<{
		readonly src: string;
		readonly predicate: string;
		readonly dst: string;
		readonly memoryId: string;
		readonly since: string | null;
	}>;
}): string => {
	const lines: string[] = [];
	const footer: Array<{ id: string; index: number }> = [];
	const indexById = new Map<string, number>();
	input.memories.forEach((hit, offset) => {
		const index = offset + 1;
		indexById.set(hit.memory.id, index);
		footer.push({ id: hit.memory.id, index });
	});
	input.memories.forEach((hit, offset) => {
		const conflict = input.conflicts?.find(
			(edge) => edge.src === hit.memory.id || edge.dst === hit.memory.id,
		);
		const otherId = conflict
			? conflict.src === hit.memory.id
				? conflict.dst
				: conflict.src
			: undefined;
		const otherIndex = otherId ? indexById.get(otherId) : undefined;
		lines.push(
			formatMemoryLine(offset + 1, hit, otherIndex ? { conflictWith: otherIndex } : undefined),
		);
	});
	(input.relations ?? []).forEach((line, offset) => {
		const index = input.memories.length + offset + 1;
		footer.push({ id: line.memoryId, index });
		lines.push(formatRelationLine(index, line, indexById.get(line.memoryId)));
	});
	input.chunks.forEach((hit, offset) => {
		const index = input.memories.length + (input.relations?.length ?? 0) + offset + 1;
		footer.push({ id: hit.chunk.id, index });
		lines.push(formatChunkLine(index, hit));
	});
	const packed = [...lines, formatIdFooter(footer)].filter((line) => line.length > 0).join("\n");
	return packed;
};

export const jsonDumpTokens = (value: unknown): number =>
	estimateTokens(JSON.stringify(value, null, 2));

export const markdownTokens = (markdown: string): number => estimateTokens(markdown);

export const memoryLabel = (memory: Memory): string => `${memory.type}·${memory.kind}`;
