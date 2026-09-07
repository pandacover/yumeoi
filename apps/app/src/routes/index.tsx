import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { defaultLlmConfig } from "@yumeoi/domain";

const getHello = createServerFn({ method: "GET" }).handler(async () => {
	const agent = env.MemoryAgent.getByName("demo");
	return agent.hello("m0");
});

export const Route = createFileRoute("/")({
	loader: () => getHello(),
	component: Home,
});

function Home() {
	const hello = Route.useLoaderData();

	return (
		<main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
			<header className="flex flex-col gap-3">
				<p className="text-sm tracking-[0.2em] text-[var(--accent)] uppercase">M0 skeleton</p>
				<h1 className="text-4xl font-semibold tracking-tight">yumeoi</h1>
				<p className="max-w-xl text-[var(--muted)]">
					Connect the apps you already use, turn their contents into memories, and serve those
					memories to chat and agents over MCP.
				</p>
			</header>

			<section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
				<h2 className="text-lg font-medium">MemoryAgent</h2>
				<p className="mt-2 text-sm text-[var(--muted)]">
					One Durable Object per user. Constructor runs Effect SQL migrations (FTS5 + sync triggers)
					under <code>blockConcurrencyWhile</code>.
				</p>
				<p className="mt-4 font-mono text-[var(--accent)]">{hello.message}</p>
				<p className="mt-1 text-sm text-[var(--muted)]">ready: {String(hello.ready)}</p>
			</section>

			<section className="grid gap-4 md:grid-cols-2">
				<div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
					<h2 className="text-lg font-medium">MCP</h2>
					<p className="mt-2 text-sm text-[var(--muted)]">
						<code>createMcpHandler</code> on the same Worker. Point MCP Inspector at:
					</p>
					<p className="mt-3 font-mono text-sm">/mcp</p>
					<p className="mt-2 text-sm text-[var(--muted)]">tool: ping</p>
				</div>
				<div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
					<h2 className="text-lg font-medium">LLM</h2>
					<p className="mt-2 text-sm text-[var(--muted)]">
						Chat is pinned to GPT-5.6 Luna at reasoning effort high. Other jobs use the same
						placeholder until M1.
					</p>
					<p className="mt-3 font-mono text-sm">
						{defaultLlmConfig.chat.model} / {defaultLlmConfig.chat.effort}
					</p>
				</div>
			</section>

			<section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
				<h2 className="text-lg font-medium">Spikes</h2>
				<ul className="mt-3 flex flex-col gap-2 font-mono text-sm text-[var(--muted)]">
					<li>GET /api/health</li>
					<li>GET /api/spikes/hello</li>
					<li>GET /api/spikes/fts</li>
					<li>POST /api/spikes/embed</li>
					<li>POST /api/spikes/vectorize</li>
					<li>POST /api/spikes/extract</li>
				</ul>
			</section>
		</main>
	);
}
