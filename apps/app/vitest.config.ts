import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import agents from "agents/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		agents(),
		cloudflareTest({
			// Unit tests stay on local fakes for determinism and speed; the test
			// worker binds no AI/Vectorize, so remote bindings only add latency and
			// flakiness. Real Workers AI + Vectorize are exercised by the dev server
			// (remoteBindings) and by eval:recall (real embeddings over REST).
			remoteBindings: false,
			wrangler: { configPath: "./wrangler.test.jsonc" },
			miniflare: {
				bindings: {
					YUMEOI_API_KEY: "ym_test_key",
					YUMEOI_USER_ID: "test-user",
					// Force the heuristic path so the unit suite stays deterministic and
					// fast even when a real key is present in a local .dev.vars (which
					// the pool otherwise loads, making tests do live LLM calls).
					OPENROUTER_API_KEY: "",
					OPENAI_API_KEY: "",
				},
			},
		}),
	],
	test: {
		include: ["test/**/*.test.ts"],
		testTimeout: 30_000,
	},
});
