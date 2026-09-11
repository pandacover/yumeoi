import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import agents from "agents/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, import.meta.dirname, "");
	const clerkPublishableKey =
		process.env.VITE_CLERK_PUBLISHABLE_KEY || env.VITE_CLERK_PUBLISHABLE_KEY || "";

	return {
		server: {
			port: 3000,
		},
		resolve: {
			tsconfigPaths: true,
		},
		define: {
			"import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify(clerkPublishableKey),
		},
		plugins: [
			cloudflare({
				viteEnvironment: { name: "ssr" },
				// Use real Workers AI + Vectorize when Cloudflare credentials exist.
				// Without them, keep bindings local so `bun run dev` does not open OAuth.
				remoteBindings: Boolean(process.env.CLOUDFLARE_API_TOKEN),
			}),
			agents(),
			tailwindcss(),
			tanstackStart({
				srcDirectory: "src",
			}),
			viteReact(),
		],
	};
});
