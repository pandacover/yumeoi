import { createOpenAI } from "@ai-sdk/openai";
import { type GatewayLlmProvider, modelIdForProvider } from "@yumeoi/cf-runtime";
import { defaultLlmConfig, type LlmEffort, type LlmJobConfig } from "@yumeoi/domain";
import type { LanguageModel } from "ai";

export const chatLanguageModel = (
	provider: GatewayLlmProvider,
	job: LlmJobConfig = defaultLlmConfig.chat,
): LanguageModel => {
	const client = createOpenAI({
		apiKey: provider.apiKey,
		baseURL: provider.baseURL,
		name: provider.provider,
		...(provider.provider === "openrouter"
			? {
					headers: {
						"HTTP-Referer": "https://yumeoi.luvmakin01.workers.dev",
						"X-Title": "yumeoi",
					},
				}
			: {}),
	});
	return client.responses(modelIdForProvider(provider.provider, job.model));
};

export const chatProviderOptions = (effort: LlmEffort = defaultLlmConfig.chat.effort) => ({
	openai: {
		reasoningEffort: effort,
	},
});
