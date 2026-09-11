import type { ChatCitation, RecallResult } from "@yumeoi/domain";

const CITATION_MARK = /\[(\d+)\]/g;

export const CHAT_SYSTEM_PROMPT = `You are horizon, a memory assistant.

Before answering questions about the user's notes, preferences, documents, decisions, or past events, call the recall tool. Use get_document when you need the full source markdown behind a citation.

Cite every factual claim with [n] matching the numbered citations returned by recall. Do not invent memories, documents, or citations. If recall is empty, say you do not have that memory yet and suggest ingesting a document or connecting a source.

Keep answers concise. Prefer memories over raw chunks when both are present.`;

export const citationsFromRecall = (result: RecallResult): ChatCitation[] => {
	const citations: ChatCitation[] = [];
	const seenMemories = new Set<string>();
	const seenDocuments = new Set<string>();

	for (const hit of result.memories) {
		if (seenMemories.has(hit.memory.id)) {
			continue;
		}
		seenMemories.add(hit.memory.id);
		const provenance = hit.provenance[0];
		if (provenance?.documentId) {
			seenDocuments.add(provenance.documentId);
		}
		citations.push({
			index: citations.length + 1,
			memoryId: hit.memory.id,
			documentId: provenance?.documentId ?? null,
			title: provenance?.title ?? hit.memory.kind,
			url: provenance?.url ?? null,
			text: hit.memory.text,
			kind: hit.memory.kind,
		});
	}

	for (const hit of result.chunks) {
		if (seenDocuments.has(hit.chunk.documentId)) {
			continue;
		}
		seenDocuments.add(hit.chunk.documentId);
		citations.push({
			index: citations.length + 1,
			memoryId: null,
			documentId: hit.chunk.documentId,
			title: hit.title,
			url: hit.url,
			text: hit.chunk.text.slice(0, 280),
			kind: null,
		});
	}

	return citations;
};

export const heuristicChatAnswer = (
	query: string,
	citations: ReadonlyArray<ChatCitation>,
): { text: string; citations: ChatCitation[] } => {
	const trimmed = query.trim();
	if (citations.length === 0) {
		return {
			text: trimmed
				? `I don't have memories about "${trimmed}" yet. Ingest a document or connect a source, then ask again.`
				: "Ask a question about your memories. I will recall them and cite the sources.",
			citations: [],
		};
	}

	const body = citations.map((citation) => `${citation.text} [${citation.index}]`).join("\n\n");
	const sources = citations
		.map((citation) => {
			const where = citation.url ?? citation.title;
			return `[${citation.index}] ${citation.title}${citation.url ? ` — ${where}` : ""}`;
		})
		.join("\n");
	return {
		text: `From your memories:\n\n${body}\n\nSources:\n${sources}`,
		citations: [...citations],
	};
};

export const lastUserText = (
	messages: ReadonlyArray<{
		role: string;
		content?: unknown;
		parts?: ReadonlyArray<{ type: string; text?: unknown }>;
	}>,
): string => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!message || message.role !== "user") {
			continue;
		}
		if (typeof message.content === "string" && message.content.trim()) {
			return message.content;
		}
		const text = (message.parts ?? [])
			.filter((part) => part.type === "text" && typeof part.text === "string")
			.map((part) => part.text as string)
			.join("");
		if (text.trim()) {
			return text;
		}
	}
	return "";
};

export const citationsFromMessageParts = (
	parts: ReadonlyArray<{
		type: string;
		data?: unknown;
		output?: unknown;
	}>,
): ChatCitation[] => {
	const collected: ChatCitation[] = [];
	for (const part of parts) {
		if (part.type === "data-citations") {
			collected.push(...citationsFromUnknown(part.data));
		}
		if (part.type === "tool-recall") {
			collected.push(...citationsFromUnknown(part.output));
		}
	}
	const byIndex = new Map<number, ChatCitation>();
	for (const citation of collected) {
		byIndex.set(citation.index, citation);
	}
	return [...byIndex.values()].sort((left, right) => left.index - right.index);
};

export const splitCitedText = (
	text: string,
): Array<{ type: "text"; value: string } | { type: "cite"; index: number }> => {
	const parts: Array<{ type: "text"; value: string } | { type: "cite"; index: number }> = [];
	let cursor = 0;
	for (const match of text.matchAll(CITATION_MARK)) {
		const start = match.index ?? 0;
		if (start > cursor) {
			parts.push({ type: "text", value: text.slice(cursor, start) });
		}
		parts.push({ type: "cite", index: Number(match[1]) });
		cursor = start + match[0].length;
	}
	if (cursor < text.length) {
		parts.push({ type: "text", value: text.slice(cursor) });
	}
	return parts;
};

const citationsFromUnknown = (value: unknown): ChatCitation[] => {
	if (!value || typeof value !== "object") {
		return [];
	}
	const record = value as { citations?: unknown };
	if (!Array.isArray(record.citations)) {
		return [];
	}
	return record.citations.filter(isChatCitation);
};

const isChatCitation = (value: unknown): value is ChatCitation => {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Partial<ChatCitation>;
	return typeof record.index === "number" && typeof record.title === "string";
};
