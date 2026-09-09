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
import { type GatewayLlmProvider, gatewayLlmLayer } from "./llm-openai.ts";
import { sqlMemoryRepoLayer } from "./memory-repo-sql.ts";
import { memoryObjectStoreLayer, r2ObjectStoreLayer } from "./object-store.ts";
import { memoryStoreLayer } from "./sqlite-do.ts";
import { vectorizeLayer } from "./vectorize.ts";

export const noopVectorIndexLayer = Layer.succeed(VectorIndex, {
	upsert: () => Effect.void,
	query: () => Effect.succeed([]),
	deleteByIds: () => Effect.void,
});

export const llmLayerFor = (options: {
	readonly providers?: ReadonlyArray<GatewayLlmProvider>;
	readonly config?: LlmConfig;
}) => {
	const config = options.config ?? defaultLlmConfig;
	if (options.providers && options.providers.length > 0) {
		return gatewayLlmLayer({
			config,
			providers: options.providers,
		});
	}
	return heuristicLlmLayer;
};

export const readUsableBinding = <T>(read: () => T, method: string): T | undefined => {
	try {
		const binding = read();
		if (binding == null || (typeof binding !== "object" && typeof binding !== "function")) {
			return undefined;
		}
		const fn = (binding as Record<string, unknown>)[method];
		return typeof fn === "function" ? binding : undefined;
	} catch {
		return undefined;
	}
};

export const makeMemoryAgentLayer = (options: {
	readonly storage: DurableObjectStorage;
	readonly ai?: Ai;
	readonly vectorize?: Vectorize;
	readonly docs?: R2Bucket;
	readonly providers?: ReadonlyArray<GatewayLlmProvider>;
	readonly config?: LlmConfig;
}) => {
	const store = memoryStoreLayer(options.storage);
	const repo = Layer.provide(sqlMemoryRepoLayer, store);
	const embeddings = options.ai ? workersAiEmbeddingsLayer(options.ai) : hashEmbeddingsLayer;
	const llm = llmLayerFor({
		...(options.providers ? { providers: options.providers } : {}),
		...(options.config ? { config: options.config } : {}),
	});
	const extractor = Layer.provide(extractorLayer, llm);
	const consolidator = Layer.provide(consolidatorLayer, llm);
	const vectors = options.vectorize ? vectorizeLayer(options.vectorize) : noopVectorIndexLayer;
	const objects = options.docs ? r2ObjectStoreLayer(options.docs) : memoryObjectStoreLayer();
	return Layer.mergeAll(store, repo, embeddings, llm, extractor, consolidator, vectors, objects);
};

export const makeMemoryAgentRuntime = (options: {
	readonly storage: DurableObjectStorage;
	readonly ai?: Ai;
	readonly vectorize?: Vectorize;
	readonly docs?: R2Bucket;
	readonly providers?: ReadonlyArray<GatewayLlmProvider>;
	readonly config?: LlmConfig;
}) => ManagedRuntime.make(makeMemoryAgentLayer(options));
