import { describe, expect, test } from "bun:test";
import {
	HALF_LIFE_MS,
	importanceFloor,
	isSemanticStale,
	recencyFactor,
	retentionScore,
	shouldArchive,
	shouldDormant,
	useFactor,
} from "./retention.ts";

describe("P6 retention formula", () => {
	test("procedural recency is always 1", () => {
		expect(recencyFactor("procedural", 10 * HALF_LIFE_MS.semantic)).toBe(1);
	});

	test("episodic recency halves every 30 days", () => {
		expect(recencyFactor("episodic", HALF_LIFE_MS.episodic)).toBeCloseTo(0.5, 8);
		expect(recencyFactor("episodic", 2 * HALF_LIFE_MS.episodic)).toBeCloseTo(0.25, 8);
	});

	test("use factor grows with access and feedback", () => {
		expect(useFactor(0, 0)).toBe(1);
		expect(useFactor(Math.E - 1, 0)).toBeCloseTo(1.25, 8);
		expect(useFactor(0, 2)).toBeCloseTo(1.3, 8);
	});

	test("explicit writes and derived summaries have importance floors", () => {
		expect(importanceFloor("agent", false)).toBe(0.6);
		expect(importanceFloor("user", false)).toBe(0.6);
		expect(importanceFloor("extracted", true)).toBe(0.3);
		expect(importanceFloor("extracted", false)).toBe(0);
	});

	test("retention clamps to 0..1 and uses sqrt(importance)", () => {
		const fresh = retentionScore({
			type: "semantic",
			importance: 0.25,
			confidence: 1,
			now: 1_000,
			lastAccessedAt: 1_000,
			observedAt: 1_000,
			accessCount: 0,
			feedbackSum: 0,
			origin: "extracted",
			hasDerivedChild: false,
		});
		expect(fresh).toBeCloseTo(0.5, 8);
		const huge = retentionScore({
			type: "procedural",
			importance: 1,
			confidence: 1,
			now: 1_000,
			lastAccessedAt: 1_000,
			observedAt: 1_000,
			accessCount: 10_000,
			feedbackSum: 40,
			origin: "user",
			hasDerivedChild: false,
		});
		expect(huge).toBe(1);
	});

	test("semantic memories go stale after two half-lives", () => {
		expect(
			isSemanticStale({ type: "semantic", observedAt: 0 }, 2 * HALF_LIFE_MS.semantic),
		).toBe(true);
		expect(
			isSemanticStale({ type: "semantic", observedAt: 0 }, 2 * HALF_LIFE_MS.semantic - 1),
		).toBe(false);
		expect(isSemanticStale({ type: "episodic", observedAt: 0 }, 10 * HALF_LIFE_MS.semantic)).toBe(
			false,
		);
	});

	test("lifecycle thresholds match the spec", () => {
		expect(
			shouldDormant({
				state: "active",
				retention: 0.24,
				now: 61 * 86_400_000,
				lastAccessedAt: 0,
				observedAt: 0,
			}),
		).toBe(true);
		expect(
			shouldDormant({
				state: "active",
				retention: 0.24,
				now: 59 * 86_400_000,
				lastAccessedAt: 0,
				observedAt: 0,
			}),
		).toBe(false);
		expect(
			shouldArchive({
				state: "dormant",
				retention: 0.09,
				now: 90 * 86_400_000,
				dormantSince: 0,
			}),
		).toBe(true);
		expect(
			shouldArchive({
				state: "dormant",
				retention: 0.11,
				now: 90 * 86_400_000,
				dormantSince: 0,
			}),
		).toBe(false);
	});
});
