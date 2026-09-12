import { describe, expect, test } from "bun:test";
import { fillMemory, type RecallResult } from "@yumeoi/domain";
import {
	citationsFromMessageParts,
	citationsFromRecall,
	heuristicChatAnswer,
	lastUserText,
	splitCitedText,
} from "./chat.ts";

const recall: RecallResult = {
	memories: [
		{
			memory: fillMemory({
				id: "mem-1",
				kind: "preference",
				text: "Luv prefers Effect 4 for the yumeoi domain layer.",
				confidence: 0.9,
				validFrom: null,
				validTo: null,
				supersedes: null,
			}),
			score: 1,
			provenance: [
				{
					sourceId: "generic",
					documentId: "doc-1",
					chunkId: "chunk-1",
					title: "Preferences",
					url: "https://example.com/prefs",
				},
			],
		},
	],
	chunks: [
		{
			chunk: {
				id: "chunk-1",
				documentId: "doc-1",
				text: "Luv prefers Effect 4 for the yumeoi domain layer.",
				contentHash: "hash",
				byteStart: 0,
				byteEnd: 48,
			},
			score: 0.5,
			title: "Preferences",
			url: "https://example.com/prefs",
			sourceId: "generic",
		},
		{
			chunk: {
				id: "chunk-2",
				documentId: "doc-2",
				text: "Workflows run fetch, normalize, chunk, embed, extract, consolidate, commit.",
				contentHash: "hash-2",
				byteStart: 0,
				byteEnd: 70,
			},
			score: 0.4,
			title: "Pipeline",
			url: null,
			sourceId: "generic",
		},
	],
};

describe("chat citations", () => {
	test("numbers memories first and skips duplicate documents", () => {
		const citations = citationsFromRecall(recall);
		expect(citations).toHaveLength(2);
		expect(citations[0]).toMatchObject({
			index: 1,
			memoryId: "mem-1",
			documentId: "doc-1",
			title: "Preferences",
		});
		expect(citations[1]).toMatchObject({
			index: 2,
			documentId: "doc-2",
			title: "Pipeline",
			memoryId: null,
		});
	});

	test("heuristic answer cites memories and lists sources", () => {
		const { text, citations } = heuristicChatAnswer(
			"What does Luv prefer?",
			citationsFromRecall(recall),
		);
		expect(citations).toHaveLength(2);
		expect(text).toContain("Effect 4");
		expect(text).toContain("[1]");
		expect(text).toContain("Sources:");
	});

	test("heuristic empty recall explains the gap", () => {
		const { text, citations } = heuristicChatAnswer("unknown topic", []);
		expect(citations).toHaveLength(0);
		expect(text).toContain("unknown topic");
		expect(text).toContain("Ingest a document");
	});

	test("lastUserText reads UI message parts", () => {
		expect(
			lastUserText([
				{ role: "assistant", parts: [{ type: "text", text: "hi" }] },
				{ role: "user", parts: [{ type: "text", text: "What does Luv prefer?" }] },
			]),
		).toBe("What does Luv prefer?");
	});

	test("splitCitedText turns marks into cite nodes", () => {
		expect(splitCitedText("prefers Effect 4 [1] always.")).toEqual([
			{ type: "text", value: "prefers Effect 4 " },
			{ type: "cite", index: 1 },
			{ type: "text", value: " always." },
		]);
	});

	test("citationsFromMessageParts reads data and tool output", () => {
		const citations = citationsFromMessageParts([
			{
				type: "tool-recall",
				output: {
					citations: [
						{
							index: 1,
							memoryId: "mem-1",
							documentId: "doc-1",
							title: "Preferences",
							url: null,
							text: "Luv prefers Effect 4",
							kind: "preference",
						},
					],
				},
			},
			{
				type: "data-citations",
				data: {
					citations: [
						{
							index: 1,
							memoryId: "mem-1",
							documentId: "doc-1",
							title: "Preferences",
							url: null,
							text: "Luv prefers Effect 4",
							kind: "preference",
						},
					],
				},
			},
		]);
		expect(citations).toHaveLength(1);
		expect(citations[0]?.index).toBe(1);
	});

	test("agent-origin memories are not titled as a Notion page", () => {
		const citations = citationsFromRecall({
			memories: [
				{
					memory: fillMemory({
						id: "mem-agent",
						kind: "fact",
						text: "Luv drinks oat milk lattes at the office every morning.",
						confidence: 0.9,
						validFrom: null,
						validTo: null,
						supersedes: null,
						origin: "agent",
					}),
					score: 1,
					provenance: [
						{
							sourceId: "notion:ws",
							documentId: "doc-notion",
							chunkId: "chunk-notion",
							title: "Coffee wiki",
							url: "https://notion.so/coffee",
						},
					],
				},
			],
			chunks: [],
		});
		expect(citations[0]?.title).toBe("agent");
		expect(citations[0]?.documentId).toBeNull();
		expect(citations[0]?.title).not.toBe("Coffee wiki");
	});
});
