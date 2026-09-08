import {
	extractedMemoryJsonSchema,
	type LlmConfig,
	type LlmUsage,
	ProviderUnavailable,
	parseResponseUsage,
	SchemaViolation,
} from "@yumeoi/domain";
import { Llm } from "@yumeoi/memory";
import { Effect, Layer, Schema } from "effect";
import OpenAI from "openai";

export const openaiGatewayLlmLayer = (options: {
	readonly apiKey: string;
	readonly baseURL: string;
	readonly config: LlmConfig;
}) => {
	const recorded: LlmUsage[] = [];
	return Layer.succeed(Llm, {
		config: options.config,
		drainUsage: () =>
			Effect.sync(() => {
				const snapshot = [...recorded];
				recorded.length = 0;
				return snapshot;
			}),
		structured: ({ job, schema, schemaName, jsonSchema, system, user }) =>
			Effect.gen(function* () {
				const jobConfig = options.config[job];
				const client = new OpenAI({
					apiKey: options.apiKey,
					baseURL: options.baseURL,
				});
				const response = yield* Effect.tryPromise({
					try: () =>
						client.responses.create({
							model: jobConfig.model,
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
						}),
					catch: (cause) =>
						new ProviderUnavailable({
							provider: "openai",
							cause,
						}),
				});
				recorded.push(parseResponseUsage(job, jobConfig, response));
				const text =
					"output_text" in response && typeof response.output_text === "string"
						? response.output_text
						: JSON.stringify(response);
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
			}),
	});
};

export { extractedMemoryJsonSchema };
