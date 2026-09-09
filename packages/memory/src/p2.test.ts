import { describe, expect, test } from "bun:test";
import { fillMemory } from "@yumeoi/domain";
import { formatMemoryLine, jsonDumpTokens, markdownTokens, packMarkdown } from "./format.ts";
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
