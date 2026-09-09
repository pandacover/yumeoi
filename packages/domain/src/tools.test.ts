import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
	FeedbackToolInput,
	ForgetToolInput,
	GetMemoryToolInput,
	RecallToolInput,
	RememberToolInput,
	SearchMemoriesToolInput,
	TOOL_SCHEMA_EXAMPLES,
	UpdateMemoryToolInput,
} from "./tools.ts";

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
			Schema.decodeUnknownSync(UpdateMemoryToolInput)(TOOL_SCHEMA_EXAMPLES.update_memory).id,
		).toContain("m_");
		expect(Schema.decodeUnknownSync(ForgetToolInput)(TOOL_SCHEMA_EXAMPLES.forget).confirm).toBe(
			true,
		);
		expect(Schema.decodeUnknownSync(FeedbackToolInput)(TOOL_SCHEMA_EXAMPLES.feedback).signal).toBe(
			1,
		);
		expect(
			Schema.decodeUnknownSync(GetMemoryToolInput)(TOOL_SCHEMA_EXAMPLES.get_memory).id,
		).toContain("m_");
	});
});
