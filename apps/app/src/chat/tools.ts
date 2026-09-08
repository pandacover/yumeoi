import type { MemoryKind, RecallResult } from "@yumeoi/domain";
import { citationsFromRecall } from "@yumeoi/memory";
import { tool } from "ai";
import { z } from "zod";

const kindSchema = z.enum(["fact", "preference", "decision", "task", "relationship", "event"]);

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
	}) => Promise<RecallResult>;
	getDocument: (id: string) => Promise<ChatDocument>;
}) => ({
	recall: tool({
		description:
			"Recall relevant memories and supporting chunks for a question. Call this before answering anything about the user's notes, preferences, documents, or past decisions.",
		inputSchema: z.object({
			query: z.string().describe("Question or topic to recall memories for"),
			sources: z.array(z.string()).optional(),
			kinds: z.array(kindSchema).optional(),
		}),
		execute: async ({ query, sources, kinds }) => {
			const result = await agent.recall({
				query,
				...(sources ? { sources } : {}),
				...(kinds ? { kinds } : {}),
				rerank: true,
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
		memories: result.memories.map((hit) => ({
			id: hit.memory.id,
			kind: hit.memory.kind,
			text: hit.memory.text,
			title: hit.provenance[0]?.title ?? null,
			url: hit.provenance[0]?.url ?? null,
			documentId: hit.provenance[0]?.documentId ?? null,
		})),
		chunks: result.chunks.map((hit) => ({
			documentId: hit.chunk.documentId,
			title: hit.title,
			url: hit.url,
			text: hit.chunk.text,
		})),
	};
};
