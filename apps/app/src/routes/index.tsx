import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { DEFAULT_LLM_PROVIDER, defaultLlmConfig, FALLBACK_LLM_PROVIDER } from "@yumeoi/domain";
import { useState } from "react";

const getHello = createServerFn({ method: "GET" }).handler(async () => {
	const agent = env.MemoryAgent.getByName("demo");
	return agent.hello("m1");
});

const demoIngest = createServerFn({ method: "POST" })
	.validator((data: { title: string; markdown: string }) => data)
	.handler(async ({ data }) => {
		const agent = env.MemoryAgent.getByName("demo");
		return agent.ingest({
			externalId: `ui-${crypto.randomUUID()}`,
			title: data.title.trim() || "Untitled",
			markdown: data.markdown,
			sourceId: "generic",
			sourceLabel: "Home UI",
			url: null,
		});
	});

const demoRecall = createServerFn({ method: "POST" })
	.validator((data: { query: string }) => data)
	.handler(async ({ data }) => {
		const agent = env.MemoryAgent.getByName("demo");
		return agent.recall({
			query: data.query,
			rerank: true,
		});
	});

export const Route = createFileRoute("/")({
	loader: () => getHello(),
	component: Home,
});

function Home() {
	const hello = Route.useLoaderData();
	const [ingestTitle, setIngestTitle] = useState("Preferences");
	const [ingestMarkdown, setIngestMarkdown] = useState(
		"Luv prefers Effect 4 for the yumeoi domain layer.",
	);
	const [ingestResult, setIngestResult] = useState<string>("");
	const [ingestBusy, setIngestBusy] = useState(false);
	const [recallQuery, setRecallQuery] = useState("What does Luv prefer?");
	const [recallResult, setRecallResult] = useState<string>("");
	const [recallBusy, setRecallBusy] = useState(false);

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
					Ingest runs <code>IngestWorkflow</code> (fetch → normalize → chunk → embed → extract →
					consolidate → commit). Hybrid search fuses Vectorize with DO SQLite FTS5.
				</p>
				<p className="mt-4 font-mono text-[var(--accent)]">{hello.message}</p>
				<p className="mt-1 text-sm text-[var(--muted)]">ready: {String(hello.ready)}</p>
			</section>

			<section className="grid gap-4 md:grid-cols-2">
				<form
					className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6"
					onSubmit={async (event) => {
						event.preventDefault();
						setIngestBusy(true);
						setIngestResult("");
						try {
							const result = await demoIngest({
								data: { title: ingestTitle, markdown: ingestMarkdown },
							});
							setIngestResult(JSON.stringify(result, null, 2));
						} catch (error) {
							setIngestResult(error instanceof Error ? error.message : String(error));
						} finally {
							setIngestBusy(false);
						}
					}}
				>
					<h2 className="text-lg font-medium">Ingest</h2>
					<p className="mt-2 text-sm text-[var(--muted)]">
						Writes to the demo MemoryAgent on this Worker.
					</p>
					<label className="mt-4 flex flex-col gap-2 text-sm">
						<span className="text-[var(--muted)]">Title</span>
						<input
							className="rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2"
							value={ingestTitle}
							onChange={(event) => setIngestTitle(event.target.value)}
							name="title"
						/>
					</label>
					<label className="mt-3 flex flex-col gap-2 text-sm">
						<span className="text-[var(--muted)]">Markdown</span>
						<textarea
							className="min-h-32 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2"
							value={ingestMarkdown}
							onChange={(event) => setIngestMarkdown(event.target.value)}
							name="markdown"
						/>
					</label>
					<button
						className="mt-4 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--bg)] disabled:opacity-50"
						disabled={ingestBusy || ingestMarkdown.trim().length === 0}
						type="submit"
					>
						{ingestBusy ? "Ingesting…" : "Ingest"}
					</button>
					{ingestResult ? (
						<pre className="mt-4 overflow-x-auto text-xs text-[var(--muted)]">{ingestResult}</pre>
					) : null}
				</form>

				<form
					className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6"
					onSubmit={async (event) => {
						event.preventDefault();
						setRecallBusy(true);
						setRecallResult("");
						try {
							const result = await demoRecall({ data: { query: recallQuery } });
							setRecallResult(JSON.stringify(result, null, 2));
						} catch (error) {
							setRecallResult(error instanceof Error ? error.message : String(error));
						} finally {
							setRecallBusy(false);
						}
					}}
				>
					<h2 className="text-lg font-medium">Recall</h2>
					<p className="mt-2 text-sm text-[var(--muted)]">
						Hybrid recall with rerank on, same path as MCP <code>recall_context</code>.
					</p>
					<label className="mt-4 flex flex-col gap-2 text-sm">
						<span className="text-[var(--muted)]">Query</span>
						<input
							className="rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2"
							value={recallQuery}
							onChange={(event) => setRecallQuery(event.target.value)}
							name="query"
						/>
					</label>
					<button
						className="mt-4 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--bg)] disabled:opacity-50"
						disabled={recallBusy || recallQuery.trim().length === 0}
						type="submit"
					>
						{recallBusy ? "Recalling…" : "Recall"}
					</button>
					{recallResult ? (
						<pre className="mt-4 overflow-x-auto text-xs text-[var(--muted)]">{recallResult}</pre>
					) : null}
				</form>
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
					<p className="mt-2 text-sm text-[var(--muted)]">
						resources: <code>memory://sources</code>, <code>memory://recent</code>
					</p>
				</div>
				<div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
					<h2 className="text-lg font-medium">LLM</h2>
					<p className="mt-2 text-sm text-[var(--muted)]">
						Chat stays Luna high, via OpenRouter with OpenAI as fallback. Extract and consolidate
						are Luna low; rerank is Luna none. See <code>docs/eval/m1.md</code>.
					</p>
					<p className="mt-3 font-mono text-sm">
						extract {defaultLlmConfig.extract.model}/{defaultLlmConfig.extract.effort}
					</p>
					<p className="mt-1 font-mono text-sm text-[var(--muted)]">
						{DEFAULT_LLM_PROVIDER} → {FALLBACK_LLM_PROVIDER}
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
					<li>GET|POST /api/keys · DELETE /api/keys/:id</li>
					<li>GET /api/health</li>
				</ul>
			</section>
		</main>
	);
}
