import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { defaultLlmConfig } from "@yumeoi/domain";

const getHello = createServerFn({ method: "GET" }).handler(async () => {
	const agent = env.MemoryAgent.getByName("demo");
	return agent.hello("m1");
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
				<p className="text-sm tracking-[0.2em] text-[var(--accent)] uppercase">
					M1 ingest + recall
				</p>
				<h1 className="text-4xl font-semibold tracking-tight">yumeoi</h1>
				<p className="max-w-xl text-[var(--muted)]">
					POST markdown to <code>/ingest</code>, extract memories, and recall them from MCP or{" "}
					<code>/api</code> with an API key.
				</p>
			</header>

			<section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
				<h2 className="text-lg font-medium">MemoryAgent</h2>
				<p className="mt-2 text-sm text-[var(--muted)]">
					Ingest runs the realtime pipeline (chunk → embed → extract → consolidate → commit). Hybrid
					search fuses Vectorize with DO SQLite FTS5.
				</p>
				<p className="mt-4 font-mono text-[var(--accent)]">{hello.message}</p>
				<p className="mt-1 text-sm text-[var(--muted)]">ready: {String(hello.ready)}</p>
			</section>

			<section className="grid gap-4 md:grid-cols-2">
				<div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
					<h2 className="text-lg font-medium">MCP</h2>
					<p className="mt-2 text-sm text-[var(--muted)]">
						API-key auth (<code>Authorization: Bearer ym_…</code>). Point Cursor at:
					</p>
					<p className="mt-3 font-mono text-sm">/mcp</p>
					<p className="mt-2 text-sm text-[var(--muted)]">
						tools: search_memories, recall_context, get_memory, get_document, add_memory,
						list_sources
					</p>
				</div>
				<div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
					<h2 className="text-lg font-medium">LLM</h2>
					<p className="mt-2 text-sm text-[var(--muted)]">
						Chat stays Luna high. Extract and consolidate are Luna low; rerank is Luna none. See{" "}
						<code>docs/eval/m1.md</code>.
					</p>
					<p className="mt-3 font-mono text-sm">
						extract {defaultLlmConfig.extract.model}/{defaultLlmConfig.extract.effort}
					</p>
				</div>
			</section>

			<section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
				<h2 className="text-lg font-medium">HTTP</h2>
				<ul className="mt-3 flex flex-col gap-2 font-mono text-sm text-[var(--muted)]">
					<li>POST /ingest</li>
					<li>POST /api/search</li>
					<li>POST /api/recall</li>
					<li>GET /api/memories/:id</li>
					<li>GET /api/documents/:id</li>
					<li>POST /api/memories</li>
					<li>GET /api/sources</li>
					<li>GET /api/health</li>
				</ul>
			</section>
		</main>
	);
}
