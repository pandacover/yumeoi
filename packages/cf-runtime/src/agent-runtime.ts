import { defaultLlmConfig, type LlmConfig } from "@yumeoi/domain";
import {
	consolidatorLayer,
	extractorLayer,
	hashEmbeddingsLayer,
	heuristicLlmLayer,
	VectorIndex,
} from "@yumeoi/memory";
import { Effect, Layer, ManagedRuntime } from "effect";
import { workersAiEmbeddingsLayer } from "./embeddings-workers-ai.ts";
import { openaiGatewayLlmLayer } from "./llm-openai.ts";
import { sqlMemoryRepoLayer } from "./memory-repo-sql.ts";
import { memoryObjectStoreLayer, r2ObjectStoreLayer } from "./object-store.ts";
import { memoryStoreLayer } from "./sqlite-do.ts";
import { vectorizeLayer } from "./vectorize.ts";

export const noopVectorIndexLayer = Layer.succeed(VectorIndex, {
	upsert: () => Effect.void,
	query: () => Effect.succeed([]),
});

export const llmLayerFor = (options: {
	readonly apiKey?: string;
	readonly baseURL?: string;
	readonly config?: LlmConfig;
}) => {
	const config = options.config ?? defaultLlmConfig;
	if (options.apiKey && options.baseURL) {
		return openaiGatewayLlmLayer({
			apiKey: options.apiKey,
			baseURL: options.baseURL,
			config,
		});
	}
	return heuristicLlmLayer;
};

export const makeMemoryAgentLayer = (options: {
	readonly storage: DurableObjectStorage;
	readonly ai?: Ai;
	readonly vectorize?: Vectorize;
	readonly docs?: R2Bucket;
	readonly openaiApiKey?: string;
	readonly gatewayBaseUrl?: string;
	readonly config?: LlmConfig;
}) => {
	const store = memoryStoreLayer(options.storage);
	const repo = Layer.provide(sqlMemoryRepoLayer, store);
	const embeddings = options.ai ? workersAiEmbeddingsLayer(options.ai) : hashEmbeddingsLayer;
	const llm = llmLayerFor({
		...(options.openaiApiKey ? { apiKey: options.openaiApiKey } : {}),
		...(options.gatewayBaseUrl ? { baseURL: options.gatewayBaseUrl } : {}),
		...(options.config ? { config: options.config } : {}),
	});
	const extractor = Layer.provide(extractorLayer, llm);
	const consolidator = Layer.provide(consolidatorLayer, llm);
	const vectors = options.vectorize ? vectorizeLayer(options.vectorize) : noopVectorIndexLayer;
	const objects = options.docs ? r2ObjectStoreLayer(options.docs) : memoryObjectStoreLayer;
	return Layer.mergeAll(store, repo, embeddings, llm, extractor, consolidator, vectors, objects);
};

export const makeMemoryAgentRuntime = (options: {
	readonly storage: DurableObjectStorage;
	readonly ai?: Ai;
	readonly vectorize?: Vectorize;
	readonly docs?: R2Bucket;
	readonly openaiApiKey?: string;
	readonly gatewayBaseUrl?: string;
	readonly config?: LlmConfig;
}) => ManagedRuntime.make(makeMemoryAgentLayer(options));
