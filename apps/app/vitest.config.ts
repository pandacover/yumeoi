import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import agents from "agents/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		agents(),
		cloudflareTest({
			remoteBindings: false,
			wrangler: { configPath: "./wrangler.test.jsonc" },
			miniflare: {
				bindings: {
					YUMEOI_API_KEY: "ym_test_key",
					YUMEOI_USER_ID: "test-user",
				},
			},
		}),
	],
	test: {
		include: ["test/**/*.test.ts"],
	},
});
