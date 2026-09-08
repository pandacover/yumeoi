import { Schema } from "effect";

export const LlmEffort = Schema.Literals(["none", "low", "medium", "high"]);
export type LlmEffort = typeof LlmEffort.Type;

export const LlmJobName = Schema.Literals(["chat", "extract", "consolidate", "rerank"]);
export type LlmJobName = typeof LlmJobName.Type;

export const LlmProviderName = Schema.Literals(["openrouter", "openai"]);
export type LlmProviderName = typeof LlmProviderName.Type;

export const DEFAULT_LLM_PROVIDER = "openrouter" as const satisfies LlmProviderName;
export const FALLBACK_LLM_PROVIDER = "openai" as const satisfies LlmProviderName;

export const LlmJobConfig = Schema.Struct({
	model: Schema.String,
	effort: LlmEffort,
});
export type LlmJobConfig = typeof LlmJobConfig.Type;

export const LlmConfig = Schema.Struct({
	chat: LlmJobConfig,
	extract: LlmJobConfig,
	consolidate: LlmJobConfig,
	rerank: LlmJobConfig,
});
export type LlmConfig = typeof LlmConfig.Type;

/**
 * Exact OpenAI API id for GPT-5.6 Luna (confirmed against the GPT-5.6 Luna model page).
 * Chat stays pinned at reasoning effort `high`.
 *
 * M1 pins extract / consolidate / rerank from the eval-set decision in docs/eval/m1.md:
 * Luna is the cost-efficient 5.6 tier; extract is the volume job so effort is `low`;
 * consolidate shares that model so prompt cache hits; rerank is on the chat latency
 * path so effort is `none`.
 */
export const CHAT_MODEL_ID = "gpt-5.6-luna";
export const EXTRACT_MODEL_ID = "gpt-5.6-luna";
export const CONSOLIDATE_MODEL_ID = "gpt-5.6-luna";
export const RERANK_MODEL_ID = "gpt-5.6-luna";

export const TERRA_MODEL_ID = "gpt-5.6-terra";

export const defaultLlmConfig: LlmConfig = {
	chat: { model: CHAT_MODEL_ID, effort: "high" },
	extract: { model: EXTRACT_MODEL_ID, effort: "low" },
	consolidate: { model: CONSOLIDATE_MODEL_ID, effort: "low" },
	rerank: { model: RERANK_MODEL_ID, effort: "none" },
};

export type LlmUsage = {
	readonly job: LlmJobName;
	readonly model: string;
	readonly effort: LlmEffort;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly reasoningTokens: number;
	readonly cachedInputTokens: number;
};

const asNumber = (value: unknown): number =>
	typeof value === "number" && Number.isFinite(value) ? value : 0;

/**
 * Read Responses API `usage` (input, output, reasoning, cached input) from a model response.
 */
export const parseResponseUsage = (
	job: LlmJobName,
	config: LlmJobConfig,
	response: unknown,
): LlmUsage => {
	const usage =
		response && typeof response === "object" && "usage" in response
			? (response as { usage?: unknown }).usage
			: undefined;
	const record = usage && typeof usage === "object" ? (usage as Record<string, unknown>) : {};
	const outputDetails =
		record.output_tokens_details && typeof record.output_tokens_details === "object"
			? (record.output_tokens_details as Record<string, unknown>)
			: {};
	const inputDetails =
		record.input_tokens_details && typeof record.input_tokens_details === "object"
			? (record.input_tokens_details as Record<string, unknown>)
			: {};
	return {
		job,
		model: config.model,
		effort: config.effort,
		inputTokens: asNumber(record.input_tokens),
		outputTokens: asNumber(record.output_tokens),
		reasoningTokens: asNumber(outputDetails.reasoning_tokens),
		cachedInputTokens: asNumber(inputDetails.cached_tokens),
	};
};

/** Candidates measured at M1 for extract (volume job). Luna `high` is omitted from the default sweep. */
export const EXTRACT_EVAL_CANDIDATES: ReadonlyArray<LlmJobConfig> = [
	{ model: EXTRACT_MODEL_ID, effort: "none" },
	{ model: EXTRACT_MODEL_ID, effort: "low" },
	{ model: EXTRACT_MODEL_ID, effort: "medium" },
	{ model: TERRA_MODEL_ID, effort: "low" },
];

export const CONSOLIDATE_EVAL_CANDIDATES: ReadonlyArray<LlmJobConfig> = [
	{ model: CONSOLIDATE_MODEL_ID, effort: "none" },
	{ model: CONSOLIDATE_MODEL_ID, effort: "low" },
];

export const RERANK_EVAL_CANDIDATES: ReadonlyArray<LlmJobConfig> = [
	{ model: RERANK_MODEL_ID, effort: "none" },
	{ model: RERANK_MODEL_ID, effort: "low" },
];
