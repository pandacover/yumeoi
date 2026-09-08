import { Schema } from "effect";

export const LlmEffort = Schema.Literals(["none", "low", "medium", "high"]);
export type LlmEffort = typeof LlmEffort.Type;

export const LlmJobName = Schema.Literals(["chat", "extract", "consolidate", "rerank"]);
export type LlmJobName = typeof LlmJobName.Type;

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

export const defaultLlmConfig: LlmConfig = {
	chat: { model: CHAT_MODEL_ID, effort: "high" },
	extract: { model: EXTRACT_MODEL_ID, effort: "low" },
	consolidate: { model: CONSOLIDATE_MODEL_ID, effort: "low" },
	rerank: { model: RERANK_MODEL_ID, effort: "none" },
};
