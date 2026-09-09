import { describe, expect, test } from "bun:test";
import { coerceTypeKind, DEFAULT_KIND_FOR_TYPE, KINDS_FOR_TYPE } from "./types.ts";

describe("type/kind matrix", () => {
	test("keeps allowed pairs", () => {
		expect(coerceTypeKind("semantic", "preference")).toEqual({
			type: "semantic",
			kind: "preference",
		});
		expect(coerceTypeKind("episodic", "decision")).toEqual({
			type: "episodic",
			kind: "decision",
		});
		expect(coerceTypeKind("procedural", "rule")).toEqual({
			type: "procedural",
			kind: "rule",
		});
	});

	test("coerces mismatches to the type default", () => {
		expect(coerceTypeKind("semantic", "event")).toEqual({
			type: "semantic",
			kind: DEFAULT_KIND_FOR_TYPE.semantic,
		});
		expect(coerceTypeKind("episodic", "preference")).toEqual({
			type: "episodic",
			kind: DEFAULT_KIND_FOR_TYPE.episodic,
		});
		expect(coerceTypeKind("procedural", "fact")).toEqual({
			type: "procedural",
			kind: DEFAULT_KIND_FOR_TYPE.procedural,
		});
	});

	test("defaults sit inside the allowed lists", () => {
		for (const type of ["semantic", "episodic", "procedural"] as const) {
			expect(KINDS_FOR_TYPE[type]).toContain(DEFAULT_KIND_FOR_TYPE[type]);
		}
	});
});
