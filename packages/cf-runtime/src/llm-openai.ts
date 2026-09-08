import {
	DEFAULT_LLM_PROVIDER,
	extractedMemoryJsonSchema,
	type LlmConfig,
	type LlmJobName,
	type LlmProviderName,
	type LlmUsage,
	ProviderUnavailable,
	parseResponseUsage,
	RateLimited,
	SchemaViolation,
} from "@yumeoi/domain";
import { Llm } from "@yumeoi/memory";
import { Effect, Layer, Result, Schedule, Schema } from "effect";
import OpenAI from "openai";

type StructuredError = ProviderUnavailable | RateLimited | SchemaViolation;

export type GatewayLlmProvider = {
	readonly provider: LlmProviderName;
	readonly apiKey: string;
	readonly baseURL: string;
};

export const modelIdForProvider = (provider: LlmProviderName, model: string): string =>
	provider === "openrouter" && !model.includes("/") ? `openai/${model}` : model;

export const resolveGatewayLlmProviders = (input: {
	readonly openrouter?: {
		readonly apiKey?: string | undefined;
		readonly baseURL?: string | undefined;
	};
	readonly openai?: { readonly apiKey?: string | undefined; readonly baseURL?: string | undefined };
}): ReadonlyArray<GatewayLlmProvider> => {
	const providers: GatewayLlmProvider[] = [];
	if (input.openrouter?.apiKey && input.openrouter.baseURL) {
		providers.push({
			provider: "openrouter",
			apiKey: input.openrouter.apiKey,
			baseURL: input.openrouter.baseURL,
		});
	}
	if (input.openai?.apiKey && input.openai.baseURL) {
		providers.push({
			provider: "openai",
			apiKey: input.openai.apiKey,
			baseURL: input.openai.baseURL,
		});
	}
	return providers;
};

export const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";
export const OPENAI_API_BASE = "https://api.openai.com/v1";

/**
 * Bind OpenRouter / OpenAI keys to their native API bases.
 *
 * This Worker enables `global_fetch_strictly_public`, so `fetch()` to
 * `gateway.ai.cloudflare.com` (from `env.AI.gateway(...).getUrl(...)`) is
 * treated as a public-internet request and fails (Cloudflare 1010 /
 * ProviderUnavailable). The eval harness already uses these same URLs.
 */
export const resolveGatewayLlmProvidersFromKeys = (options: {
	readonly openrouterApiKey?: string | undefined;
	readonly openaiApiKey?: string | undefined;
}): ReadonlyArray<GatewayLlmProvider> =>
	resolveGatewayLlmProviders({
		openrouter: options.openrouterApiKey
			? { apiKey: options.openrouterApiKey, baseURL: OPENROUTER_API_BASE }
			: undefined,
		openai: options.openaiApiKey
			? { apiKey: options.openaiApiKey, baseURL: OPENAI_API_BASE }
			: undefined,
	});

const httpStatusOf = (cause: unknown): number | undefined => {
	if (!cause || typeof cause !== "object") {
		return undefined;
	}
	const record = cause as { status?: unknown; statusCode?: unknown };
	if (typeof record.status === "number") {
		return record.status;
	}
	if (typeof record.statusCode === "number") {
		return record.statusCode;
	}
	return undefined;
};

export const classifyGatewayError = (
	provider: LlmProviderName,
	cause: unknown,
): RateLimited | ProviderUnavailable => {
	if (httpStatusOf(cause) === 429) {
		return new RateLimited({ provider });
	}
	return new ProviderUnavailable({ provider, cause });
};

const isTransientLlmError = (error: StructuredError): boolean => {
	if (error._tag === "RateLimited") {
		return true;
	}
	if (error._tag !== "ProviderUnavailable") {
		return false;
	}
	const status = httpStatusOf(error.cause);
	return status === undefined || status >= 500 || status === 429;
};

const withLlmResilience = <A>(
	provider: LlmProviderName,
	effect: Effect.Effect<A, StructuredError>,
) =>
	effect.pipe(
		Effect.timeout("45 seconds"),
		Effect.catchTag("TimeoutError", () =>
			Effect.fail(new ProviderUnavailable({ provider, cause: "timeout" })),
		),
		Effect.retry({
			times: 2,
			while: isTransientLlmError,
			schedule: Schedule.exponential("200 millis"),
		}),
		Effect.withSpan("llm.structured", { attributes: { "llm.provider": provider } }),
	);

export const firstAvailableStructured = <A>(
	attempts: ReadonlyArray<() => Effect.Effect<A, StructuredError>>,
): Effect.Effect<A, StructuredError> =>
	Effect.gen(function* () {
		let lastTransient: ProviderUnavailable | RateLimited | undefined;
		for (const attempt of attempts) {
			const outcome = yield* Effect.result(attempt());
			if (Result.isSuccess(outcome)) {
				return outcome.success;
			}
			if (outcome.failure._tag === "SchemaViolation") {
				return yield* Effect.fail(outcome.failure);
			}
			lastTransient = outcome.failure;
		}
		return yield* Effect.fail(
			lastTransient ?? new ProviderUnavailable({ provider: DEFAULT_LLM_PROVIDER }),
		);
	});

const structuredFromProvider = <A, I>(
	provider: GatewayLlmProvider,
	config: LlmConfig,
	options: {
		readonly job: LlmJobName;
		readonly schema: Schema.Codec<A, I>;
		readonly schemaName: string;
		readonly jsonSchema: Record<string, unknown>;
		readonly system: string;
		readonly user: string;
	},
	recorded: LlmUsage[],
) =>
	Effect.gen(function* () {
		const jobConfig = config[options.job];
		const client = new OpenAI({
			apiKey: provider.apiKey,
			baseURL: provider.baseURL,
			...(provider.provider === "openrouter"
				? {
						defaultHeaders: {
							"HTTP-Referer": "https://yumeoi.luvmakin01.workers.dev",
							"X-Title": "yumeoi",
						},
					}
				: {}),
		});
		const response = yield* Effect.tryPromise({
			try: () =>
				client.responses.create({
					model: modelIdForProvider(provider.provider, jobConfig.model),
					...(jobConfig.effort === "none" ? {} : { reasoning: { effort: jobConfig.effort } }),
					input: [
						{ role: "system", content: options.system },
						{ role: "user", content: options.user },
					],
					text: {
						format: {
							type: "json_schema",
							name: options.schemaName,
							strict: true,
							schema: options.jsonSchema,
						},
					},
				}),
			catch: (cause) => classifyGatewayError(provider.provider, cause),
		});
		recorded.push(parseResponseUsage(options.job, jobConfig, response));
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
		return yield* Schema.decodeUnknownEffect(options.schema)(parsed).pipe(
			Effect.mapError(
				(issues) =>
					new SchemaViolation({
						message: "structured output failed schema decode",
						issues,
					}),
			),
		);
	});

export const gatewayLlmLayer = (options: {
	readonly config: LlmConfig;
	readonly providers: ReadonlyArray<GatewayLlmProvider>;
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
		structured: (request) =>
			firstAvailableStructured(
				options.providers.map(
					(provider) => () =>
						withLlmResilience(
							provider.provider,
							structuredFromProvider(provider, options.config, request, recorded),
						),
				),
			),
	});
};

export const openaiGatewayLlmLayer = (options: {
	readonly apiKey: string;
	readonly baseURL: string;
	readonly config: LlmConfig;
}) =>
	gatewayLlmLayer({
		config: options.config,
		providers: [{ provider: "openai", apiKey: options.apiKey, baseURL: options.baseURL }],
	});

export { extractedMemoryJsonSchema };
