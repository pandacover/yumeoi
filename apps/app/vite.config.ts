import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import agents from "agents/vite";
import { defineConfig } from "vite";

export default defineConfig({
	server: {
		port: 3000,
	},
	resolve: {
		tsconfigPaths: true,
	},
	plugins: [
		cloudflare({
			viteEnvironment: { name: "ssr" },
			// Use real Workers AI + Vectorize in local dev so retrieval matches
			// production. Requires CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID and
			// the provisioned "yumeoi-memories" index (bun run provision:vectorize).
			remoteBindings: true,
		}),
		agents(),
		tailwindcss(),
		tanstackStart({
			srcDirectory: "src",
		}),
		viteReact(),
	],
});
