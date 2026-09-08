import { createOpenAI } from "@ai-sdk/openai";
import { type GatewayLlmProvider, modelIdForProvider } from "@yumeoi/cf-runtime";
import { defaultLlmConfig, type LlmEffort, type LlmJobConfig } from "@yumeoi/domain";

export const chatLanguageModel = (
	provider: GatewayLlmProvider,
	job: LlmJobConfig = defaultLlmConfig.chat,
) => {
	const client = createOpenAI({
		apiKey: provider.apiKey,
		baseURL: provider.baseURL,
		name: provider.provider,
	});
	return client.responses(modelIdForProvider(provider.provider, job.model));
};

export const chatProviderOptions = (effort: LlmEffort = defaultLlmConfig.chat.effort) => ({
	openai: {
		reasoningEffort: effort,
	},
});
