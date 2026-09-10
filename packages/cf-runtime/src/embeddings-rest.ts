import { ProviderUnavailable } from "@yumeoi/domain";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, Embeddings } from "@yumeoi/memory";
import { Effect, Layer } from "effect";

type WorkersAiEmbeddingResponse = {
	readonly success?: boolean;
	readonly result?: { readonly data?: ReadonlyArray<ReadonlyArray<number>> };
	readonly errors?: unknown;
};

/**
 * Real Workers AI embeddings over the Cloudflare REST API, for contexts that
 * have no `env.AI` binding (e.g. the Bun-based eval runners). This lets evals
 * benchmark against the same bge-m3 model production uses instead of the
 * deterministic hash fallback.
 */
export const restWorkersAiEmbeddingsLayer = (options: {
	readonly accountId: string;
	readonly apiToken: string;
	readonly model?: string;
	readonly baseURL?: string;
}) => {
	const model = options.model ?? EMBEDDING_MODEL;
	const base = options.baseURL ?? "https://api.cloudflare.com/client/v4";
	const url = `${base}/accounts/${options.accountId}/ai/run/${model}`;
	return Layer.succeed(Embeddings, {
		model,
		dimensions: EMBEDDING_DIMENSIONS,
		embed: (texts) =>
			Effect.tryPromise({
				try: async () => {
					const response = await fetch(url, {
						method: "POST",
						headers: {
							Authorization: `Bearer ${options.apiToken}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ text: [...texts] }),
					});
					if (!response.ok) {
						throw new Error(`Workers AI REST ${response.status}: ${await response.text()}`);
					}
					const json = (await response.json()) as WorkersAiEmbeddingResponse;
					const data = json.result?.data;
					if (!json.success || !Array.isArray(data)) {
						throw new Error(`Workers AI REST error: ${JSON.stringify(json.errors ?? json)}`);
					}
					if (data.some((vector) => vector.length !== EMBEDDING_DIMENSIONS)) {
						throw new Error(`expected ${EMBEDDING_DIMENSIONS}-d embeddings from ${model}`);
					}
					return data;
				},
				catch: (cause) => new ProviderUnavailable({ provider: "workers-ai", cause }),
			}),
	});
};
