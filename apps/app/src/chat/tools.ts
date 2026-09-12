import { MEMORY_KINDS, type MemoryKind, type RecallResult } from "@yumeoi/domain";
import { citationSourceForHit, citationsFromRecall } from "@yumeoi/memory";
import { type ToolSet, tool } from "ai";
import { z } from "zod";

const kindSchema = z.enum(MEMORY_KINDS);

type ChatDocument = {
	id: string;
	title: string;
	url: string | null;
	markdown: string;
};

export const createMemoryChatTools = (agent: {
	recall: (query: {
		query: string;
		sources?: ReadonlyArray<string>;
		kinds?: ReadonlyArray<MemoryKind>;
		rerank?: boolean;
		format?: "markdown" | "json";
		plan?: "fast" | "full";
	}) => Promise<RecallResult>;
	getDocument: (id: string) => Promise<ChatDocument>;
}): ToolSet => ({
	recall: tool({
		description:
			"Recall relevant memories and supporting chunks for a question. Call this before answering anything about the user's notes, preferences, documents, or past decisions.",
		inputSchema: z.object({
			query: z.string().describe("Question or topic to recall memories for"),
			kinds: z.array(kindSchema).optional(),
		}),
		execute: async ({ query, kinds }) => {
			const result = await agent.recall({
				query,
				...(kinds ? { kinds } : {}),
				rerank: true,
				format: "json",
				plan: "fast",
			});
			return compactRecall(result);
		},
	}),
	get_document: tool({
		description: "Load the full normalized markdown for a document cited by recall.",
		inputSchema: z.object({
			id: z.string().describe("Document id from recall provenance"),
		}),
		execute: async ({ id }) => {
			const document = await agent.getDocument(id);
			return {
				id: document.id,
				title: document.title,
				url: document.url,
				markdown: document.markdown,
			};
		},
	}),
});

export const compactRecall = (result: RecallResult) => {
	const citations = citationsFromRecall(result);
	return {
		citations,
		memories: result.memories.map((hit) => {
			const source = citationSourceForHit(hit);
			return {
				id: hit.memory.id,
				kind: hit.memory.kind,
				text: hit.memory.text,
				origin: hit.memory.origin,
				title: source?.title ?? (hit.memory.origin === "extracted" ? null : hit.memory.origin),
				url: source?.url ?? null,
				documentId: source?.documentId ?? null,
			};
		}),
		chunks: result.chunks.map((hit) => ({
			documentId: hit.chunk.documentId,
			title: hit.title,
			url: hit.url,
			text: hit.chunk.text,
		})),
	};
};
