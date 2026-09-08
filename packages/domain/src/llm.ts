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
 * Chat is pinned here at reasoning effort `high`. Extract / consolidate / rerank were
 * pinned from the live OpenRouter eval in `docs/eval/m1.md`.
 *
 * OpenRouter slugs are `openai/${model}`. Runtime calls prefer OpenRouter and fall
 * back to the OpenAI API / AI Gateway.
 */
export const CHAT_MODEL_ID = "gpt-5.6-luna";
export const TERRA_MODEL_ID = "gpt-5.6-terra";
export const EXTRACT_MODEL_ID = CHAT_MODEL_ID;
export const CONSOLIDATE_MODEL_ID = CHAT_MODEL_ID;
export const RERANK_MODEL_ID = CHAT_MODEL_ID;

export const defaultLlmConfig: LlmConfig = {
	chat: { model: CHAT_MODEL_ID, effort: "high" },
	extract: { model: EXTRACT_MODEL_ID, effort: "high" },
	consolidate: { model: CONSOLIDATE_MODEL_ID, effort: "none" },
	rerank: { model: RERANK_MODEL_ID, effort: "none" },
};
