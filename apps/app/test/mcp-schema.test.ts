import { TOOL_ERROR_HINTS, TOOL_FIELD_DESCRIPTIONS } from "@yumeoi/domain";
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
		expect(String(recall.from?.description)).not.toMatch(/ISO-8601 string\.$/);
		const remember = mcpInputJsonSchema(rememberInputSchema);
		const rememberProps = propertyNodes(remember);
		expect(String(rememberProps.text?.description)).toMatch(/items/);
		expect(String(rememberProps.items?.description)).toMatch(/text/);
		const feedback = propertyNodes(mcpInputJsonSchema(feedbackInputSchema));
		expect(String(feedback.signal?.description)).toMatch(/1/);
		expect(feedback.signal?.anyOf ?? feedback.signal?.enum ?? feedback.signal?.type).toBeTruthy();
	});

	it("returns structured hints for schema mistakes instead of throwing", async () => {
		const missing = await runTool(rememberInputSchema, {}, async () => {
			throw new Error("handler should not run");
		});
		expect(missing).toMatchObject({ isError: true });
		const missingBody = JSON.parse(
			(missing as { content: Array<{ text: string }> }).content[0].text,
		);
		expect(missingBody.error).toBe("invalid_input");
		expect(missingBody.hint).toBe(TOOL_ERROR_HINTS.rememberPayload);

		const badSignal = await runTool(feedbackInputSchema, { id: "m_abc", signal: 0 }, async () => {
			throw new Error("handler should not run");
		});
		const signalBody = JSON.parse(
			(badSignal as { content: Array<{ text: string }> }).content[0].text,
		);
		expect(signalBody.hint).toBe(TOOL_ERROR_HINTS.feedbackSignal);

		const isoFrom = await runTool(
			recallInputSchema,
			{ query: "preferences", from: "2026-01-01" },
			async () => {
				throw new Error("handler should not run");
			},
		);
		const fromBody = JSON.parse((isoFrom as { content: Array<{ text: string }> }).content[0].text);
		expect(fromBody.hint).toBe(TOOL_ERROR_HINTS.epochMs("from"));

		const forgetBare = await runTool(forgetInputSchema, {}, async () => {
			throw new Error("handler should not run");
		});
		const forgetBody = JSON.parse(
			(forgetBare as { content: Array<{ text: string }> }).content[0].text,
		);
		expect(forgetBody.hint).toBe(TOOL_ERROR_HINTS.forgetTarget);

		const forgetQuery = await runTool(forgetInputSchema, { query: "oat milk" }, async () => {
			throw new Error("handler should not run");
		});
		const forgetQueryBody = JSON.parse(
			(forgetQuery as { content: Array<{ text: string }> }).content[0].text,
		);
		expect(forgetQueryBody.hint).toBe(TOOL_ERROR_HINTS.forgetQueryConfirm);
	});

	it("maps extracted-forget and unauthorized failures without stack traces", () => {
		const extracted = asError(
			new Error("memory m_abc is extracted; pass confirm=true to forget it"),
		);
		const extractedBody = JSON.parse(extracted.content[0].text);
		expect(extractedBody.error).toBe("invalid_input");
		expect(extractedBody.hint).toMatch(/confirm=true/);
		expect(extractedBody.hint).not.toMatch(/\nat /);

		const unauthorized = asError(new Error("unauthorized: MCP session has no user"));
		const unauthorizedBody = JSON.parse(unauthorized.content[0].text);
		expect(unauthorizedBody.error).toBe("unauthorized");
		expect(unauthorizedBody.hint).toMatch(/reconnect/i);
	});
});
