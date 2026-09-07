import {
	extractedMemoryJsonSchema,
	openaiGatewayLlmLayer,
	vectorizeLayer,
	workersAiEmbeddingsLayer,
} from "@yumeoi/cf-runtime";
import { defaultLlmConfig, ExtractedMemory, ProviderUnavailable } from "@yumeoi/domain";
import { Embeddings, Llm, VectorIndex } from "@yumeoi/memory";
import { Effect, Layer, ManagedRuntime } from "effect";

const json = (body: unknown, status = 200) =>
	Response.json(body, {
		status,
		headers: { "cache-control": "no-store" },
	});

const gatewayBaseUrl = async (env: Env) => {
	const gatewayId = env.AI_GATEWAY_ID || "default";
	try {
		return await env.AI.gateway(gatewayId).getUrl("openai");
	} catch {
		return undefined;
	}
};

const spikeRuntime = (env: Env, baseURL: string | undefined) => {
	const embeddings = workersAiEmbeddingsLayer(env.AI);
	const vectors = vectorizeLayer(env.VECTORIZE);
	const llm = baseURL
		? openaiGatewayLlmLayer({
				apiKey: env.OPENAI_API_KEY ?? "sk-placeholder",
				baseURL,
				config: defaultLlmConfig,
			})
		: Layer.succeed(Llm, {
				config: defaultLlmConfig,
				structured: () => Effect.fail(new ProviderUnavailable({ provider: "openai" })),
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
		const runtime = spikeRuntime(env, undefined);
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
		const baseURL = await gatewayBaseUrl(env);
		if (!baseURL || !env.OPENAI_API_KEY) {
			return json(
				{
					error: "OPENAI_API_KEY and AI Gateway are required for the extract spike",
					schema: extractedMemoryJsonSchema(),
				},
				503,
			);
		}
		const runtime = spikeRuntime(env, baseURL);
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
		const runtime = spikeRuntime(env, undefined);
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
