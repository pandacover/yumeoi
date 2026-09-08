import {
	extractedMemoryJsonSchema,
	type GatewayLlmProvider,
	gatewayLlmLayer,
	resolveGatewayLlmProvidersFromKeys,
	vectorizeLayer,
	workersAiEmbeddingsLayer,
} from "@yumeoi/cf-runtime";
import { defaultLlmConfig, ExtractedMemory } from "@yumeoi/domain";
import { Embeddings, Llm, VectorIndex } from "@yumeoi/memory";
import { Effect, Layer, ManagedRuntime } from "effect";

const json = (body: unknown, status = 200) =>
	Response.json(body, {
		status,
		headers: { "cache-control": "no-store" },
	});

const llmProvidersFromEnv = (env: Env) =>
	resolveGatewayLlmProvidersFromKeys({
		getUrl: (provider) => env.AI.gateway(env.AI_GATEWAY_ID || "default").getUrl(provider),
		openrouterApiKey: env.OPENROUTER_API_KEY,
		openaiApiKey: env.OPENAI_API_KEY,
	});

const spikeRuntime = (env: Env, providers: ReadonlyArray<GatewayLlmProvider> = []) => {
	const embeddings = workersAiEmbeddingsLayer(env.AI);
	const vectors = vectorizeLayer(env.VECTORIZE);
	const llm = gatewayLlmLayer({
		config: defaultLlmConfig,
		providers,
	});
	return ManagedRuntime.make(Layer.mergeAll(embeddings, vectors, llm));
};

export async function handleSpikes(request: Request, env: Env): Promise<Response | null> {
	const url = new URL(request.url);

	if (url.pathname === "/api/spikes/hello") {
		const name = url.searchParams.get("name") ?? "m0";
		const agent = env.MemoryAgent.getByName("demo");
		const hello = await agent.hello(name);
		return json(hello);
	}

	if (url.pathname === "/api/spikes/fts") {
		const query = url.searchParams.get("q") ?? "yumeoi";
		const agent = env.MemoryAgent.getByName("demo");
		const result = await agent.pingFts(query);
		return json(result);
	}

	if (url.pathname === "/api/spikes/embed" && request.method === "POST") {
		const body = (await request.json().catch(() => ({}))) as { text?: string };
		const text = body.text ?? "yumeoi remembers the apps you already use";
		const runtime = spikeRuntime(env);
		try {
			const payload = await runtime.runPromise(
				Effect.gen(function* () {
					const embeddings = yield* Embeddings;
					const vectors = yield* embeddings.embed([text]);
					return {
						model: embeddings.model,
						dimensions: vectors[0]?.length ?? 0,
						preview: vectors[0]?.slice(0, 8) ?? [],
					};
				}),
			);
			return json(payload);
		} catch (error) {
			return json({ error: String(error) }, 503);
		} finally {
			await runtime.dispose();
		}
	}

	if (url.pathname === "/api/spikes/extract" && request.method === "POST") {
		const body = (await request.json().catch(() => ({}))) as { text?: string };
		const text = body.text ?? "Luv is building yumeoi on Cloudflare Workers.";
		const providers = await llmProvidersFromEnv(env);
		if (providers.length === 0) {
			return json(
				{
					error:
						"OPENROUTER_API_KEY or OPENAI_API_KEY and AI Gateway are required for the extract spike",
					schema: extractedMemoryJsonSchema(),
				},
				503,
			);
		}
		const runtime = spikeRuntime(env, providers);
		try {
			const memory = await runtime.runPromise(
				Effect.gen(function* () {
					const llm = yield* Llm;
					return yield* llm.structured({
						job: "extract",
						schema: ExtractedMemory,
						schemaName: "extracted_memory",
						jsonSchema: extractedMemoryJsonSchema(),
						system:
							"Extract one atomic, self-contained memory as JSON. Use kind, text, confidence, validFrom.",
						user: text,
					});
				}),
			);
			return json({ memory, model: defaultLlmConfig.extract });
		} catch (error) {
			return json({ error: String(error) }, 502);
		} finally {
			await runtime.dispose();
		}
	}

	if (url.pathname === "/api/spikes/vectorize" && request.method === "POST") {
		const body = (await request.json().catch(() => ({}))) as { text?: string };
		const text = body.text ?? "vectorize spike";
		const runtime = spikeRuntime(env);
		try {
			const result = await runtime.runPromise(
				Effect.gen(function* () {
					const embeddings = yield* Embeddings;
					const index = yield* VectorIndex;
					const [values] = yield* embeddings.embed([text]);
					if (!values) {
						return yield* Effect.fail(new Error("no embedding"));
					}
					yield* index.upsert([
						{
							id: "spike-vector",
							values,
							namespace: "demo",
							metadata: {
								sourceId: "generic",
								documentId: "spike",
								kind: "fact",
								ts: Date.now(),
							},
						},
					]);
					const matches = yield* index.query({
						values,
						namespace: "demo",
						topK: 3,
					});
					return { dimensions: values.length, matches };
				}),
			);
			return json(result);
		} catch (error) {
			return json({ error: String(error) }, 503);
		} finally {
			await runtime.dispose();
		}
	}

	if (url.pathname.startsWith("/api/")) {
		return json({ error: "not found" }, 404);
	}

	return null;
}
