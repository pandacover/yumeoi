import {
	extractedMemoryJsonSchema,
	type LlmConfig,
	ProviderUnavailable,
	SchemaViolation,
} from "@yumeoi/domain";
import { Llm } from "@yumeoi/memory";
import { Effect, Layer, Schema } from "effect";
import OpenAI from "openai";

type StructuredClient = {
	readonly provider: string;
	readonly config: LlmConfig;
	readonly client: OpenAI;
	readonly resolveModel: (model: string) => string;
	readonly mode: "responses" | "chat";
};

const decodeStructured = <A, I>(schema: Schema.Codec<A, I>, text: string) =>
	Effect.gen(function* () {
		const parsed = yield* Effect.try({
			try: () => JSON.parse(text) as unknown,
			catch: (cause) =>
				new SchemaViolation({
					message: "model did not return JSON",
					issues: cause,
				}),
		});
		return yield* Schema.decodeUnknownEffect(schema)(parsed).pipe(
			Effect.mapError(
				(issues) =>
					new SchemaViolation({
						message: "structured output failed schema decode",
						issues,
					}),
			),
		);
	});

const structuredLayer = (options: StructuredClient) =>
	Layer.succeed(Llm, {
		config: options.config,
		structured: ({ job, schema, schemaName, jsonSchema, system, user }) =>
			Effect.gen(function* () {
				const jobConfig = options.config[job];
				const model = options.resolveModel(jobConfig.model);
				const text = yield* Effect.tryPromise({
					try: async () => {
						if (options.mode === "responses") {
							const response = await options.client.responses.create({
								model,
								...(jobConfig.effort === "none" ? {} : { reasoning: { effort: jobConfig.effort } }),
								input: [
									{ role: "system", content: system },
									{ role: "user", content: user },
								],
								text: {
									format: {
										type: "json_schema",
										name: schemaName,
										strict: true,
										schema: jsonSchema,
									},
								},
							});
							return "output_text" in response && typeof response.output_text === "string"
								? response.output_text
								: JSON.stringify(response);
						}
						const completion = await options.client.chat.completions.create({
							model,
							messages: [
								{ role: "system", content: system },
								{ role: "user", content: user },
							],
							response_format: {
								type: "json_schema",
								json_schema: {
									name: schemaName,
									strict: true,
									schema: jsonSchema,
								},
							},
							reasoning: { effort: jobConfig.effort },
						} as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
						const content = completion.choices[0]?.message.content;
						if (typeof content !== "string" || content.length === 0) {
							throw new Error("empty chat completion");
						}
						return content;
					},
					catch: (cause) =>
						new ProviderUnavailable({
							provider: options.provider,
							cause,
						}),
				});
				return yield* decodeStructured(schema, text);
			}),
	});

export const openaiGatewayLlmLayer = (options: {
	readonly apiKey: string;
	readonly baseURL: string;
	readonly config: LlmConfig;
}) =>
	structuredLayer({
		provider: "openai",
		config: options.config,
		client: new OpenAI({
			apiKey: options.apiKey,
			baseURL: options.baseURL,
		}),
		resolveModel: (model) => model,
		mode: "responses",
	});

export const openrouterLlmLayer = (options: {
	readonly apiKey: string;
	readonly config: LlmConfig;
}) =>
	structuredLayer({
		provider: "openrouter",
		config: options.config,
		client: new OpenAI({
			apiKey: options.apiKey,
			baseURL: "https://openrouter.ai/api/v1",
			defaultHeaders: {
				"HTTP-Referer": "https://yumeoi.dev",
				"X-Title": "yumeoi",
			},
		}),
		resolveModel: (model) => (model.includes("/") ? model : `openai/${model}`),
		mode: "chat",
	});

export { extractedMemoryJsonSchema };
