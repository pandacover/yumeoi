import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { type EvalDocument, scoreExtraction, summarizeScores } from "./eval.ts";
import { heuristicExtract } from "./heuristic-llm.ts";

const set = JSON.parse(
	readFileSync(new URL("../../../docs/eval/m1-set.json", import.meta.url), "utf8"),
) as { documents: EvalDocument[] };

describe("m1 eval harness", () => {
	test("eval set has 20-50 labeled docs covering every kind", () => {
		expect(set.documents.length).toBeGreaterThanOrEqual(20);
		expect(set.documents.length).toBeLessThanOrEqual(50);
		const kinds = new Set(set.documents.flatMap((doc) => doc.expected.map((item) => item.kind)));
		for (const kind of ["fact", "preference", "decision", "task", "relationship", "event"]) {
			expect(kinds.has(kind as EvalDocument["expected"][number]["kind"])).toBe(true);
		}
	});

	test("heuristic extractor scores against the labeled set", () => {
		const scores = set.documents.map((doc) =>
			scoreExtraction(doc, heuristicExtract(`${doc.title}\n\n${doc.markdown}`)),
		);
		const summary = summarizeScores(scores);
		expect(summary.documents).toBe(set.documents.length);
		expect(summary.recall).toBeGreaterThan(0.3);
		expect(summary.precision).toBeGreaterThan(0.2);
	});
});
