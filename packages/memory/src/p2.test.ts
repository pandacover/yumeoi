import { describe, expect, test } from "bun:test";
import { fillMemory } from "@yumeoi/domain";
import {
	formatChunkLine,
	formatMemoryLine,
	jsonDumpTokens,
	markdownTokens,
	packMarkdown,
} from "./format.ts";
import { detectIntent, planQueryFast, tokenizeQuery } from "./retrieval/plan.ts";

describe("P2 format and planner", () => {
	test("packed markdown is much smaller than pretty JSON", () => {
		const memory = fillMemory({
			id: "m_abcabcabcabc",
			kind: "preference",
			text: "Luv prefers Effect 4 for the yumeoi domain layer.",
			confidence: 0.92,
			validFrom: null,
			validTo: null,
			supersedes: null,
			type: "semantic",
			observedAt: Date.parse("2026-08-30"),
		});
		const hit = {
			memory,
			score: 1,
			provenance: [
				{
					sourceId: "notion",
					documentId: "d1",
					chunkId: "c1",
					title: "Effect notes",
					url: null,
				},
			],
			why: ["kw", "vec"] as const,
		};
		const markdown = packMarkdown({ memories: [hit], chunks: [] });
		expect(markdown).toContain("[1]");
		expect(markdown).toContain("ids: m_abcabcabcabc=[1]");
		expect(markdownTokens(markdown)).toBeLessThan(
			jsonDumpTokens({ memories: [hit], chunks: [] }) * 0.6,
		);
		expect(formatMemoryLine(1, hit)).toContain("semantic·preference");
		expect(formatMemoryLine(1, hit)).toContain('extracted·src "Effect notes"');
		expect(formatMemoryLine(1, hit)).not.toContain(", src ");
	});

	test("memory lines show origin separately from document src", () => {
		const extracted = fillMemory({
			id: "m_extracted001",
			kind: "preference",
			text: "Luv prefers Effect 4 for the yumeoi domain layer.",
			confidence: 0.92,
			validFrom: null,
			validTo: null,
			supersedes: null,
			type: "semantic",
			origin: "extracted",
			observedAt: Date.parse("2026-08-30"),
		});
		const notion = {
			sourceId: "notion:ws",
			documentId: "d1",
			chunkId: "c1",
			title: "Effect notes",
			url: null,
		};
		const agentNotes = {
			sourceId: "agent:claude",
			documentId: "agent:claude:notes",
			chunkId: "c-agent",
			title: "Agent notes",
			url: null,
		};
		const extractedLine = formatMemoryLine(1, {
			memory: extracted,
			score: 1,
			provenance: [notion],
		});
		expect(extractedLine).toContain('extracted·src "Effect notes"');

		const agentTransferred = formatMemoryLine(1, {
			memory: { ...extracted, origin: "agent", text: "Luv prefers Effect 4 and oat milk lattes." },
			score: 1,
			provenance: [notion, agentNotes],
		});
		expect(agentTransferred).toContain("agent");
		expect(agentTransferred).toContain('also "Effect notes"');
		expect(agentTransferred).not.toMatch(/extracted·src "Effect notes"/);
		expect(agentTransferred).not.toMatch(/agent·src "Effect notes"/);

		const agentOnly = formatMemoryLine(1, {
			memory: { ...extracted, origin: "agent" },
			score: 1,
			provenance: [agentNotes],
		});
		expect(agentOnly).toContain("(semantic·preference, conf .92, seen 2026-08-30, agent)");
		expect(agentOnly).not.toContain("src ");
	});

	test("evidence chunk lines stay document-titled", () => {
		expect(
			formatChunkLine(4, {
				chunk: {
					id: "c1",
					documentId: "d1",
					text: "Luv prefers Effect 4 for the yumeoi domain layer.",
					contentHash: "h",
					byteStart: 0,
					byteEnd: 40,
				},
				score: 1,
				title: "Effect notes",
				url: null,
				sourceId: "notion:ws",
			}),
		).toBe('[4] (evidence, src "Effect notes") Luv prefers Effect 4 for the yumeoi domain layer.');
	});

	test("planner detects howto and history intents", () => {
		expect(detectIntent("How do I deploy yumeoi?")).toBe("howto");
		expect(detectIntent("What happened last week?")).toBe("history");
		expect(tokenizeQuery("the deploying worker")).toContain("deploying");
		const plan = planQueryFast({ query: "what happened last week" });
		expect(plan.intent).toBe("history");
		expect(plan.temporalFrom).not.toBeNull();
	});
});
