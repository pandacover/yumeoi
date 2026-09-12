import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
	InvalidRequest,
	NotFound,
	ProviderUnavailable,
	SchemaViolation,
	Unauthorized,
} from "./errors.ts";
import { hintForFieldIssues, mapToolFailure, TOOL_ERROR_HINTS } from "./tool-errors.ts";
import {
	AddMemoryAliasInput,
	AGENT_INSTRUCTIONS,
	ChangesSinceToolInput,
	FeedbackToolInput,
	ForgetToolInput,
	GetEntityToolInput,
	GetMemoryToolInput,
	MCP_TOOL_DESCRIPTIONS,
	RecallContextAliasInput,
	RecallToolInput,
	RememberToolInput,
	SearchMemoriesToolInput,
	TimelineToolInput,
	TOOL_FIELD_DESCRIPTIONS,
	TOOL_SCHEMA_EXAMPLES,
	toolInputJsonSchema,
	UpdateMemoryToolInput,
} from "./tools.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const propertyDescriptions = (
	schema: Record<string, unknown>,
	prefix = "",
): Array<{ path: string; description: string }> => {
	const properties = isRecord(schema.properties) ? schema.properties : {};
	const out: Array<{ path: string; description: string }> = [];
	for (const [key, node] of Object.entries(properties)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (!isRecord(node)) {
			continue;
		}
		if (typeof node.description === "string" && node.description.length > 0) {
			out.push({ path, description: node.description });
		}
		const items = isRecord(node.items) ? node.items : null;
		if (items) {
			if (typeof items.description === "string" && items.description.length > 0) {
				out.push({ path: `${path}[]`, description: items.description });
			}
			out.push(...propertyDescriptions(items, `${path}[]`));
		}
		out.push(...propertyDescriptions(node, path));
	}
	return out;
};

describe("tool contract v2", () => {
	test("MCP examples decode through Effect schemas", () => {
		expect(Schema.decodeUnknownSync(RecallToolInput)(TOOL_SCHEMA_EXAMPLES.recall).query).toBe(
			TOOL_SCHEMA_EXAMPLES.recall.query,
		);
		expect(
			Schema.decodeUnknownSync(SearchMemoriesToolInput)(TOOL_SCHEMA_EXAMPLES.search_memories).query,
		).toBe("Effect 4");
		expect(
			Schema.decodeUnknownSync(RememberToolInput)(TOOL_SCHEMA_EXAMPLES.remember).text,
		).toContain("Effect 4");
		expect(
			Schema.decodeUnknownSync(RememberToolInput)(TOOL_SCHEMA_EXAMPLES.remember_items).items?.[0]
				?.clientRef,
		).toBe("note-1");
		expect(
			Schema.decodeUnknownSync(UpdateMemoryToolInput)(TOOL_SCHEMA_EXAMPLES.update_memory).id,
		).toContain("m_");
		expect(Schema.decodeUnknownSync(ForgetToolInput)(TOOL_SCHEMA_EXAMPLES.forget).confirm).toBe(
			true,
		);
		expect(Schema.decodeUnknownSync(FeedbackToolInput)(TOOL_SCHEMA_EXAMPLES.feedback).query).toBe(
			"What does Luv prefer?",
		);
		expect(
			Schema.decodeUnknownSync(FeedbackToolInput)(TOOL_SCHEMA_EXAMPLES.feedback_correct).signal,
		).toBe(-1);
		expect(
			Schema.decodeUnknownSync(GetMemoryToolInput)(TOOL_SCHEMA_EXAMPLES.get_memory).id,
		).toContain("m_");
		expect(
			Schema.decodeUnknownSync(RecallContextAliasInput)(TOOL_SCHEMA_EXAMPLES.recall_context).query,
		).toContain("Luv");
		expect(
			Schema.decodeUnknownSync(AddMemoryAliasInput)(TOOL_SCHEMA_EXAMPLES.add_memory).text,
		).toContain("Effect 4");
		expect(Schema.decodeUnknownSync(GetEntityToolInput)(TOOL_SCHEMA_EXAMPLES.get_entity).name).toBe(
			"Luv",
		);
		expect(Schema.decodeUnknownSync(TimelineToolInput)(TOOL_SCHEMA_EXAMPLES.timeline).about).toBe(
			"Aurora",
		);
		expect(
			Schema.decodeUnknownSync(ChangesSinceToolInput)(TOOL_SCHEMA_EXAMPLES.changes_since).since,
		).toBe(1_700_000_000_000);
	});

	test("Effect JSON schemas include field descriptions", () => {
		const described = [
			...propertyDescriptions(toolInputJsonSchema(RecallToolInput)),
			...propertyDescriptions(toolInputJsonSchema(SearchMemoriesToolInput)),
			...propertyDescriptions(toolInputJsonSchema(RememberToolInput)),
			...propertyDescriptions(toolInputJsonSchema(UpdateMemoryToolInput)),
			...propertyDescriptions(toolInputJsonSchema(ForgetToolInput)),
			...propertyDescriptions(toolInputJsonSchema(FeedbackToolInput)),
			...propertyDescriptions(toolInputJsonSchema(GetMemoryToolInput)),
			...propertyDescriptions(toolInputJsonSchema(GetEntityToolInput)),
			...propertyDescriptions(toolInputJsonSchema(TimelineToolInput)),
			...propertyDescriptions(toolInputJsonSchema(ChangesSinceToolInput)),
			...propertyDescriptions(toolInputJsonSchema(RecallContextAliasInput)),
			...propertyDescriptions(toolInputJsonSchema(AddMemoryAliasInput)),
		];
		const byPath = new Map(described.map((item) => [item.path, item.description]));
		expect(byPath.get("query")).toContain(TOOL_FIELD_DESCRIPTIONS.recall.query.slice(0, 24));
		expect(byPath.get("from")).toMatch(/milliseconds/i);
		expect(byPath.get("signal")).toContain("1");
		expect(byPath.get("confirm")).toMatch(/confirm/i);
		expect(byPath.get("text") ?? byPath.get("items")).toBeTruthy();
		expect(described.every((item) => item.description.length > 8)).toBe(true);
		expect(AGENT_INSTRUCTIONS).toContain("retry_with");
		expect(AGENT_INSTRUCTIONS).toMatch(/Do not invent new fields/);
		expect(AGENT_INSTRUCTIONS).toMatch(/unavailable/);
		expect(AGENT_INSTRUCTIONS).toMatch(/once/);
		expect(MCP_TOOL_DESCRIPTIONS.remember).toContain("Example:");
		expect(MCP_TOOL_DESCRIPTIONS.recall).toContain("Example:");
		expect(MCP_TOOL_DESCRIPTIONS.feedback).toContain("Example:");
		expect(MCP_TOOL_DESCRIPTIONS.forget).toContain("Example:");
		const recallProps = toolInputJsonSchema(RecallToolInput).properties;
		expect(isRecord(recallProps)).toBe(true);
		if (isRecord(recallProps)) {
			for (const node of Object.values(recallProps)) {
				expect(isRecord(node) && typeof node.description === "string").toBe(true);
			}
		}
	});
});

describe("mapToolFailure", () => {
	test("maps tagged and schema failures to actionable hints", () => {
		expect(mapToolFailure(new Unauthorized({ message: "MCP session has no user" }))).toEqual({
			error: "unauthorized",
			hint: TOOL_ERROR_HINTS.unauthorized,
		});
		expect(mapToolFailure(new NotFound({ entity: "memory", id: "m_abc" })).hint).toContain("m_abc");
		expect(
			mapToolFailure(
				new InvalidRequest({
					message: "memory m_abc is extracted; pass confirm=true to forget it",
				}),
			).hint,
		).toMatch(/confirm=true/);
		expect(
			mapToolFailure(
				new InvalidRequest({ message: "forget requires id, or query plus confirm=true" }),
			).hint,
		).toContain("confirm=true");
		expect(mapToolFailure(new Error("unauthorized: MCP session has no user")).error).toBe(
			"unauthorized",
		);
		expect(mapToolFailure(new Error("memory m_xyz was not found")).error).toBe("not_found");
		expect(
			hintForFieldIssues([{ path: ["signal"], message: "Invalid literal value, expected 1 | -1" }]),
		).toBe(TOOL_ERROR_HINTS.feedbackSignal);
		expect(
			hintForFieldIssues([{ path: ["from"], message: "Expected number, received string" }]),
		).toBe(TOOL_ERROR_HINTS.epochMs("from"));
		expect(hintForFieldIssues([{ path: ["id"], message: "forget needs id or query" }])).toBe(
			TOOL_ERROR_HINTS.forgetTarget,
		);
		expect(
			hintForFieldIssues([
				{ path: ["confirm"], message: "forgetting by query requires confirm=true" },
			]),
		).toBe(TOOL_ERROR_HINTS.forgetQueryConfirm);
		expect(
			hintForFieldIssues([{ path: ["text"], message: "remember needs text or items[]" }]),
		).toBe(TOOL_ERROR_HINTS.rememberPayload);
		const schemaFail = mapToolFailure({
			issues: [{ path: ["since"], message: "Expected number, received string" }],
		});
		expect(schemaFail.error).toBe("invalid_input");
		expect(schemaFail.hint).toContain("milliseconds");
		expect(mapToolFailure(new Error("Error: boom\n    at foo (server.ts:1:1)")).hint).not.toMatch(
			/at foo/,
		);
	});

	test("maps ProviderUnavailable and SchemaViolation to tagged MCP errors", () => {
		const unavailable = mapToolFailure(
			new ProviderUnavailable({
				provider: "openrouter",
				cause:
					"402 This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens",
			}),
		);
		expect(unavailable.error).toBe("unavailable");
		expect(unavailable.hint).toMatch(/OPENROUTER_API_KEY/);
		expect(unavailable.hint).toMatch(/65536|credits|unavailable/i);
		expect(unavailable.hint).toMatch(/Do not retry/);

		const missing = mapToolFailure(
			new ProviderUnavailable({
				provider: "openrouter",
				cause: "no llm provider configured",
			}),
		);
		expect(missing.error).toBe("unavailable");
		expect(missing.hint).toBe(TOOL_ERROR_HINTS.llmMissing);

		const schema = mapToolFailure(
			new SchemaViolation({ message: "structured output failed schema decode" }),
		);
		expect(schema.error).toBe("schema_violation");
		expect(schema.hint).toMatch(/server-side failure|schema/i);

		expect(
			mapToolFailure(
				new Error(
					"ProviderUnavailable: 402 This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens",
				),
			).error,
		).toBe("unavailable");
	});
});
