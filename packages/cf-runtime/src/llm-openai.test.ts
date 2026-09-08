import { describe, expect, test } from "bun:test";
import { ProviderUnavailable, RateLimited, SchemaViolation } from "@yumeoi/domain";
import { Effect } from "effect";
import {
	classifyGatewayError,
	firstAvailableStructured,
	modelIdForProvider,
	resolveGatewayLlmProviders,
	resolveGatewayLlmProvidersFromKeys,
} from "./llm-openai.ts";

describe("modelIdForProvider", () => {
	test("prefixes OpenRouter with openai/ for the same model ids", () => {
		expect(modelIdForProvider("openrouter", "gpt-5.6-luna")).toBe("openai/gpt-5.6-luna");
		expect(modelIdForProvider("openai", "gpt-5.6-luna")).toBe("gpt-5.6-luna");
	});

	test("leaves already-qualified OpenRouter ids alone", () => {
		expect(modelIdForProvider("openrouter", "openai/gpt-5.6-luna")).toBe("openai/gpt-5.6-luna");
	});
});

describe("resolveGatewayLlmProviders", () => {
	test("puts OpenRouter first and OpenAI second when both are configured", () => {
		expect(
			resolveGatewayLlmProviders({
				openrouter: { apiKey: "or-key", baseURL: "https://gateway.example/openrouter" },
				openai: { apiKey: "oa-key", baseURL: "https://gateway.example/openai" },
			}),
		).toEqual([
			{ provider: "openrouter", apiKey: "or-key", baseURL: "https://gateway.example/openrouter" },
			{ provider: "openai", apiKey: "oa-key", baseURL: "https://gateway.example/openai" },
		]);
	});

	test("skips a provider that is missing a key or gateway URL", () => {
		expect(
			resolveGatewayLlmProviders({
				openrouter: { apiKey: "or-key" },
				openai: { apiKey: "oa-key", baseURL: "https://gateway.example/openai" },
			}),
		).toEqual([
			{ provider: "openai", apiKey: "oa-key", baseURL: "https://gateway.example/openai" },
		]);
	});
});

describe("firstAvailableStructured", () => {
	test("uses the first successful provider", async () => {
		const result = await Effect.runPromise(
			firstAvailableStructured([
				() => Effect.succeed("openrouter"),
				() => Effect.succeed("openai"),
			]),
		);
		expect(result).toBe("openrouter");
	});

	test("falls back to OpenAI when OpenRouter is unavailable", async () => {
		const result = await Effect.runPromise(
			firstAvailableStructured([
				() => Effect.fail(new ProviderUnavailable({ provider: "openrouter" })),
				() => Effect.succeed("openai"),
			]),
		);
		expect(result).toBe("openai");
	});

	test("does not fall back after a schema violation", async () => {
		const error = await Effect.runPromise(
			firstAvailableStructured([
				() => Effect.fail(new SchemaViolation({ message: "bad json" })),
				() => Effect.succeed("openai"),
			]).pipe(Effect.flip),
		);
		expect(error._tag).toBe("SchemaViolation");
		expect(error.message).toBe("bad json");
	});

	test("falls back when the first provider is rate limited", async () => {
		const result = await Effect.runPromise(
			firstAvailableStructured([
				() => Effect.fail(new RateLimited({ provider: "openrouter" })),
				() => Effect.succeed("openai"),
			]),
		);
		expect(result).toBe("openai");
	});
});

describe("classifyGatewayError", () => {
	test("maps HTTP 429 to RateLimited", () => {
		const error = classifyGatewayError("openrouter", { status: 429 });
		expect(error._tag).toBe("RateLimited");
		expect(error.provider).toBe("openrouter");
	});

	test("maps other failures to ProviderUnavailable", () => {
		const error = classifyGatewayError("openai", { status: 503 });
		expect(error._tag).toBe("ProviderUnavailable");
		expect(error.provider).toBe("openai");
	});
});

describe("resolveGatewayLlmProvidersFromKeys", () => {
	test("resolves OpenRouter first when both keys can fetch a gateway URL", async () => {
		const providers = await resolveGatewayLlmProvidersFromKeys({
			getUrl: async (provider) => `https://gateway.example/${provider}`,
			openrouterApiKey: "or-key",
			openaiApiKey: "oa-key",
		});
		expect(providers.map((provider) => provider.provider)).toEqual(["openrouter", "openai"]);
		expect(providers[0]?.baseURL).toBe("https://gateway.example/openrouter");
	});

	test("skips OpenRouter when its gateway URL cannot be resolved", async () => {
		const providers = await resolveGatewayLlmProvidersFromKeys({
			getUrl: async (provider) => {
				if (provider === "openrouter") {
					throw new Error("no openrouter gateway");
				}
				return `https://gateway.example/${provider}`;
			},
			openrouterApiKey: "or-key",
			openaiApiKey: "oa-key",
		});
		expect(providers).toEqual([
			{ provider: "openai", apiKey: "oa-key", baseURL: "https://gateway.example/openai" },
		]);
	});
});
