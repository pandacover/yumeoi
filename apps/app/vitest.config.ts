import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import agents from "agents/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		agents(),
		cloudflareTest({
			remoteBindings: false,
			wrangler: { configPath: "./wrangler.test.jsonc" },
		}),
	],
	test: {
		include: ["test/**/*.test.ts"],
	},
});
