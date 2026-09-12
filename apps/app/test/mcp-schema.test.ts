import {
	MCP_TOOL_DESCRIPTIONS,
	parseToolErrorText,
	TOOL_ERROR_HINTS,
	TOOL_FIELD_DESCRIPTIONS,
} from "@yumeoi/domain";
import { describe, expect, it } from "vitest";
import { asError, runTool } from "../src/mcp/errors.ts";
import {
	feedbackInputSchema,
	forgetInputSchema,
	HORIZON_MCP_INPUT_SCHEMAS,
	mcpInputJsonSchema,
	recallInputSchema,
	rememberInputSchema,
} from "../src/mcp/schemas.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const propertyNodes = (
	schema: Record<string, unknown>,
): Record<string, Record<string, unknown>> => {
	if (!isRecord(schema.properties)) {
		return {};
	}
	const out: Record<string, Record<string, unknown>> = {};
	for (const [key, node] of Object.entries(schema.properties)) {
		if (isRecord(node)) {
			out[key] = node;
		}
	}
	return out;
};

const errorFrom = (result: unknown) => {
	expect(result).toMatchObject({ isError: true });
	const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? "";
	return parseToolErrorText(text);
};

describe("Horizon MCP tool schemas", () => {
	it("publishes a description on every input field", () => {
		for (const [name, schema] of Object.entries(HORIZON_MCP_INPUT_SCHEMAS)) {
			const json = mcpInputJsonSchema(schema);
			const properties = propertyNodes(json);
			for (const [field, node] of Object.entries(properties)) {
				expect(node.description, `${name}.${field} missing description`).toEqual(
					expect.any(String),
				);
				expect(
					String(node.description).length,
					`${name}.${field} description too short`,
				).toBeGreaterThan(8);
			}
		}
		const recall = propertyNodes(mcpInputJsonSchema(recallInputSchema));
		expect(recall.query?.description).toBe(TOOL_FIELD_DESCRIPTIONS.recall.query);
		expect(String(recall.from?.description)).toMatch(/milliseconds/i);
		expect(String(recall.from?.description)).toMatch(/ISO-8601 strings are coerced/i);
		const remember = mcpInputJsonSchema(rememberInputSchema);
		const rememberProps = propertyNodes(remember);
		expect(String(rememberProps.text?.description)).toMatch(/items/);
		expect(String(rememberProps.items?.description)).toMatch(/text/);
		const feedback = propertyNodes(mcpInputJsonSchema(feedbackInputSchema));
		expect(String(feedback.signal?.description)).toMatch(/1/);
		expect(feedback.signal?.anyOf ?? feedback.signal?.enum ?? feedback.signal?.type).toBeTruthy();
	});

	it("hot tools include a one-line Example JSON in the description", () => {
		expect(MCP_TOOL_DESCRIPTIONS.remember).toContain('Example: {"text":"...","mode":"verbatim"}');
		expect(MCP_TOOL_DESCRIPTIONS.recall).toContain('Example: {"query":"..."}');
		expect(MCP_TOOL_DESCRIPTIONS.feedback).toContain('Example: {"id":"m_…","signal":1}');
		expect(MCP_TOOL_DESCRIPTIONS.forget).toContain('Example: {"id":"m_…"}');
	});

	it("returns structured hints with retry_with for schema mistakes instead of throwing", async () => {
		const missing = await runTool("remember", rememberInputSchema, {}, async () => {
			throw new Error("handler should not run");
		});
		const missingBody = errorFrom(missing);
		expect(missingBody.error).toBe("invalid_input");
		expect(missingBody.hint).toBe(TOOL_ERROR_HINTS.rememberPayload);
		expect(missingBody.retry_with).toEqual({ text: "...", mode: "verbatim" });
		expect(missingBody.lead).toBe("Remember failed: need text or items[].");
		expect((missing as { content: Array<{ text: string }> }).content[0].text).toContain(
			'retry_with: {"text":"...","mode":"verbatim"}',
		);

		const badSignal = await runTool(
			"feedback",
			feedbackInputSchema,
			{ id: "m_abc", signal: 0 },
			async () => {
				throw new Error("handler should not run");
			},
		);
		const signalBody = errorFrom(badSignal);
		expect(signalBody.hint).toBe(TOOL_ERROR_HINTS.feedbackSignal);
		expect(signalBody.retry_with).toEqual({ id: "m_abc", signal: 1 });
		expect(signalBody.lead).toBe("Feedback failed: signal must be 1 or -1.");

		const unparseableFrom = await runTool(
			"recall",
			recallInputSchema,
			{ query: "preferences", from: "yesterday" },
			async () => {
				throw new Error("handler should not run");
			},
		);
		const fromBody = errorFrom(unparseableFrom);
		expect(fromBody.hint).toBe(TOOL_ERROR_HINTS.epochMs("from"));
		expect(fromBody.retry_with).toEqual({ query: "preferences" });

		const forgetBare = await runTool("forget", forgetInputSchema, {}, async () => {
			throw new Error("handler should not run");
		});
		const forgetBody = errorFrom(forgetBare);
		expect(forgetBody.hint).toBe(TOOL_ERROR_HINTS.forgetTarget);
		expect(forgetBody.retry_with).toEqual({ id: "m_…" });

		const forgetQuery = await runTool(
			"forget",
			forgetInputSchema,
			{ query: "oat milk" },
			async () => {
				throw new Error("handler should not run");
			},
		);
		const forgetQueryBody = errorFrom(forgetQuery);
		expect(forgetQueryBody.hint).toBe(TOOL_ERROR_HINTS.forgetQueryConfirm);
		expect(forgetQueryBody.retry_with).toEqual({ query: "oat milk", confirm: true });
	});

	it("coerces common agent mistakes so the handler still runs", async () => {
		const signal = await runTool(
			"feedback",
			feedbackInputSchema,
			{ id: "m_abc", signal: "1" },
			async (parsed) => parsed,
		);
		expect(signal).toMatchObject({ id: "m_abc", signal: 1 });

		const negative = await runTool(
			"feedback",
			feedbackInputSchema,
			{ id: "m_abc", signal: "-1" },
			async (parsed) => parsed,
		);
		expect(negative).toMatchObject({ id: "m_abc", signal: -1 });

		const isoFrom = await runTool(
			"recall",
			recallInputSchema,
			{ query: "preferences", from: "2026-01-01T00:00:00.000Z" },
			async (parsed) => parsed,
		);
		expect(isoFrom).toMatchObject({
			query: "preferences",
			from: Date.parse("2026-01-01T00:00:00.000Z"),
		});

		const textOnly = await runTool(
			"remember",
			rememberInputSchema,
			{ text: "Luv prefers oat milk.", mode: "verbatim" },
			async (parsed) => parsed,
		);
		expect(textOnly).toEqual({ text: "Luv prefers oat milk.", mode: "verbatim" });

		const droppedKind = await runTool(
			"remember",
			rememberInputSchema,
			{ text: "Luv prefers oat milk.", kind: "note", type: "memory" },
			async (parsed) => parsed,
		);
		expect(droppedKind).toEqual({ text: "Luv prefers oat milk." });

		const itemKind = await runTool(
			"remember",
			rememberInputSchema,
			{ items: [{ text: "Luv prefers oat milk.", kind: "note", importance: "0.9" }] },
			async (parsed) => parsed,
		);
		expect(itemKind).toEqual({
			items: [{ text: "Luv prefers oat milk.", importance: 0.9 }],
		});
	});

	it("maps extracted-forget and unauthorized failures without stack traces", () => {
		const extracted = asError(
			new Error("memory m_abc is extracted; pass confirm=true to forget it"),
			{ tool: "forget", input: { id: "m_abc" } },
		);
		const extractedBody = parseToolErrorText(extracted.content[0].text);
		expect(extractedBody.error).toBe("invalid_input");
		expect(extractedBody.hint).toMatch(/confirm=true/);
		expect(extractedBody.hint).not.toMatch(/\nat /);
		expect(extractedBody.retry_with).toEqual({ id: "m_abc", confirm: true });

		const unauthorized = asError(new Error("unauthorized: MCP session has no user"), {
			tool: "remember",
			input: { text: "keep me" },
		});
		const unauthorizedBody = parseToolErrorText(unauthorized.content[0].text);
		expect(unauthorizedBody.error).toBe("unauthorized");
		expect(unauthorizedBody.hint).toMatch(/reconnect/i);
		expect(unauthorizedBody.retry_with).toEqual({ text: "keep me", mode: "verbatim" });
	});
});
