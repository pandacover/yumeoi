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
			// Remote AI/Vectorize bindings require Cloudflare login; M0 uses local fakes.
			remoteBindings: false,
		}),
		agents(),
		tailwindcss(),
		tanstackStart({
			srcDirectory: "src",
		}),
		viteReact(),
	],
});
