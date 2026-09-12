import { describe, expect, test } from "bun:test";
import { TOOL_ERROR_HINTS } from "./tool-errors.ts";
import {
	formatToolErrorText,
	leadForToolError,
	parseToolErrorText,
	preprocessToolInput,
	retryWithForTool,
} from "./tool-input.ts";

const asRecord = (value: unknown): Record<string, unknown> => {
	expect(value).toEqual(expect.any(Object));
	return value as Record<string, unknown>;
};

describe("preprocessToolInput", () => {
	test("coerces feedback.signal from strings and numbers", () => {
		expect(asRecord(preprocessToolInput({ id: "m_abc", signal: "1" })).signal).toBe(1);
		expect(asRecord(preprocessToolInput({ id: "m_abc", signal: "-1" })).signal).toBe(-1);
		expect(asRecord(preprocessToolInput({ id: "m_abc", signal: 1 })).signal).toBe(1);
		expect(asRecord(preprocessToolInput({ id: "m_abc", signal: -1 })).signal).toBe(-1);
		expect(asRecord(preprocessToolInput({ id: "m_abc", signal: "useful" })).signal).toBe("useful");
	});

	test("coerces ISO-8601 timestamps to millisecond epochs", () => {
		const iso = "2026-01-01T00:00:00.000Z";
		const coerced = asRecord(preprocessToolInput({ query: "prefs", from: iso, to: "2026-01-01" }));
		expect(coerced.from).toBe(Date.parse(iso));
		expect(coerced.to).toBe(Date.parse("2026-01-01"));
		expect(asRecord(preprocessToolInput({ since: "1700000000000" })).since).toBe(1_700_000_000_000);
		expect(asRecord(preprocessToolInput({ query: "x", from: 1_700_000_000_000 })).from).toBe(
			1_700_000_000_000,
		);
	});

	test("coerces importance numeric strings and omits empty optional fields", () => {
		const item = asRecord(
			preprocessToolInput({
				text: "Luv prefers oat milk.",
				mode: "",
				kind: "",
				items: [{ text: "kept", importance: "0.8", note: "" }],
			}),
		);
		expect(item.text).toBe("Luv prefers oat milk.");
		expect("mode" in item).toBe(false);
		expect("kind" in item).toBe(false);
		const items = item.items as Array<Record<string, unknown>>;
		expect(items[0]?.importance).toBe(0.8);
		expect("note" in (items[0] ?? {})).toBe(false);
	});

	test("drops invalid or mismatched remember kind/type instead of failing", () => {
		const invalid = asRecord(
			preprocessToolInput({
				text: "Luv prefers oat milk.",
				kind: "note",
				type: "memory",
			}),
		);
		expect(invalid.text).toBe("Luv prefers oat milk.");
		expect("kind" in invalid).toBe(false);
		expect("type" in invalid).toBe(false);

		const swapped = asRecord(
			preprocessToolInput({
				items: [{ text: "Luv prefers oat milk.", kind: "semantic", type: "preference" }],
			}),
		);
		const swappedItem = (swapped.items as Array<Record<string, unknown>>)[0] ?? {};
		expect(swappedItem.text).toBe("Luv prefers oat milk.");
		expect("kind" in swappedItem).toBe(false);
		expect("type" in swappedItem).toBe(false);

		const mismatched = asRecord(
			preprocessToolInput({
				items: [{ text: "Ship P2.", kind: "preference", type: "episodic" }],
			}),
		);
		const mismatchedItem = (mismatched.items as Array<Record<string, unknown>>)[0] ?? {};
		expect(mismatchedItem.text).toBe("Ship P2.");
		expect("kind" in mismatchedItem).toBe(false);
		expect("type" in mismatchedItem).toBe(false);

		const valid = asRecord(
			preprocessToolInput({
				items: [{ text: "Ship P2.", kind: "preference", type: "semantic" }],
			}),
		);
		expect((valid.items as Array<Record<string, unknown>>)[0]).toMatchObject({
			text: "Ship P2.",
			kind: "preference",
			type: "semantic",
		});
	});

	test("remember with only text is unchanged", () => {
		expect(preprocessToolInput({ text: "Luv prefers oat milk.", mode: "verbatim" })).toEqual({
			text: "Luv prefers oat milk.",
			mode: "verbatim",
		});
	});
});

describe("retry_with and error text", () => {
	test("remember without text retries with the minimal verbatim payload", () => {
		const retry = retryWithForTool("remember", {}, { hint: TOOL_ERROR_HINTS.rememberPayload });
		expect(retry).toEqual({ text: "...", mode: "verbatim" });
		const text = formatToolErrorText({
			tool: "remember",
			error: "invalid_input",
			hint: TOOL_ERROR_HINTS.rememberPayload,
			retry_with: retry,
		});
		expect(text.startsWith("Remember failed: need text or items[].")).toBe(true);
		expect(text).toContain(`retry_with: ${JSON.stringify(retry)}`);
		const parsed = parseToolErrorText(text);
		expect(parsed.error).toBe("invalid_input");
		expect(parsed.retry_with).toEqual(retry);
		expect(parsed.lead).toMatch(/Remember failed/i);
	});

	test("feedback with a bad signal retries using the given id and signal 1", () => {
		const retry = retryWithForTool(
			"feedback",
			{ id: "m_abc", signal: "useful" },
			{ hint: TOOL_ERROR_HINTS.feedbackSignal },
		);
		expect(retry).toEqual({ id: "m_abc", signal: 1 });
		expect(leadForToolError("feedback", "invalid_input", TOOL_ERROR_HINTS.feedbackSignal)).toBe(
			"Feedback failed: signal must be 1 or -1.",
		);
	});

	test("forget by query retries with confirm=true", () => {
		expect(
			retryWithForTool(
				"forget",
				{ query: "oat milk" },
				{ hint: TOOL_ERROR_HINTS.forgetQueryConfirm },
			),
		).toEqual({
			query: "oat milk",
			confirm: true,
		});
	});
});
