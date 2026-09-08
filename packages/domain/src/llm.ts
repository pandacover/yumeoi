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
 * Chat is pinned here at reasoning effort `high`. Extract / consolidate / rerank stay
 * on the same placeholder until live M1 evals pin winners (`docs/eval/m1.md`).
 *
 * OpenRouter slugs are `openai/${model}`. Runtime calls prefer OpenRouter and fall
 * back to the OpenAI API.
 */
export const CHAT_MODEL_ID = "gpt-5.6-luna";
export const TERRA_MODEL_ID = "gpt-5.6-terra";

export const defaultLlmConfig: LlmConfig = {
	chat: { model: CHAT_MODEL_ID, effort: "high" },
	extract: { model: CHAT_MODEL_ID, effort: "high" },
	consolidate: { model: CHAT_MODEL_ID, effort: "high" },
	rerank: { model: CHAT_MODEL_ID, effort: "high" },
};
