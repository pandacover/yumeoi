import { describe, expect, test } from "bun:test";
import { newShortId } from "./ids.ts";

describe("short ids", () => {
	test("uses prefix plus 12 crockford chars", () => {
		for (const prefix of ["m", "e", "r"] as const) {
			const id = newShortId(prefix);
			expect(id).toMatch(new RegExp(`^${prefix}_[0-9a-hjkmnp-tv-z]{12}$`));
			expect(id).toHaveLength(prefix.length + 1 + 12);
		}
	});

	test("does not collide in a small sample", () => {
		const ids = new Set(Array.from({ length: 200 }, () => newShortId("m")));
		expect(ids.size).toBe(200);
	});
});
