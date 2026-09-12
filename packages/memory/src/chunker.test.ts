import { describe, expect, test } from "bun:test";
import { chunkMarkdown } from "./chunker.ts";
import { ftsMatchQuery, ftsMatchWeighted, parseFtsMatch, recencyBoost, rrfScore } from "./rrf.ts";

describe("chunkMarkdown", () => {
	test("splits on headings and keeps utf-8 byte ranges", () => {
		const markdown = "# One\nhello world\n\n## Two\nmore text here";
		const chunks = chunkMarkdown(markdown);
		expect(chunks.length).toBeGreaterThanOrEqual(2);
		expect(chunks[0]?.text).toContain("One");
		expect(chunks.some((chunk) => chunk.text.includes("Two"))).toBe(true);
		for (const chunk of chunks) {
			expect(chunk.byteEnd).toBeGreaterThan(chunk.byteStart);
		}
	});

	test("windows a long section with overlap", () => {
		const markdown = "word ".repeat(800);
		const chunks = chunkMarkdown(markdown);
		expect(chunks.length).toBeGreaterThan(1);
	});
});

describe("rrf", () => {
	test("boosts items that appear in multiple lists", () => {
		const scores = rrfScore([
			["a", "b", "c"],
			["b", "a", "d"],
		]);
		expect(scores.get("b") ?? 0).toBeGreaterThan(scores.get("c") ?? 0);
	});

	test("recency prefers newer timestamps", () => {
		const now = Date.now();
		const fresh = recencyBoost(1, now, now);
		const old = recencyBoost(1, now - 86_400_000 * 30, now);
		expect(fresh).toBeGreaterThan(old);
	});

	test("ftsMatchQuery quotes tokens", () => {
		expect(ftsMatchQuery("hello, yumeoi!")).toBe('"hello" OR "yumeoi"');
		expect(ftsMatchQuery("???")).toBeNull();
	});

	test("ftsMatchWeighted keeps specific terms and drops generic ones", () => {
		expect(
			ftsMatchWeighted([
				{ term: "Horizon", weight: 12 },
				{ term: "memory", weight: 1 },
			]),
		).toBe('"Horizon"');
		expect(
			ftsMatchWeighted([
				{ term: "memory", weight: 1 },
				{ term: "context", weight: 1 },
			]),
		).toBe('"memory" OR "context"');
		expect(parseFtsMatch('"Horizon" OR "memory"')).toEqual([
			{ term: "Horizon", weight: 1 },
			{ term: "memory", weight: 1 },
		]);
	});
});
