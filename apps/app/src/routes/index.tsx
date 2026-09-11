import { env } from "cloudflare:workers";
import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { DEFAULT_LLM_PROVIDER, defaultLlmConfig, FALLBACK_LLM_PROVIDER } from "@yumeoi/domain";
import { useState } from "react";
import { appUserId } from "../api/sources.ts";

const getHello = createServerFn({ method: "GET" }).handler(async () => {
	const userId = appUserId(env);
	const agent = env.MemoryAgent.getByName(userId);
	return { ...(await agent.hello("m4")), userId };
});

const demoIngest = createServerFn({ method: "POST" })
	.validator((data: { title: string; markdown: string }) => data)
	.handler(async ({ data }) => {
		const agent = env.MemoryAgent.getByName(appUserId(env));
		try {
			return await agent.startIngest({
				externalId: `ui-${crypto.randomUUID()}`,
				title: data.title.trim() || "Untitled",
				markdown: data.markdown,
				sourceId: "generic",
				sourceLabel: "Home UI",
				url: null,
			});
		} catch (error) {
			throw error instanceof Error && error.message.trim()
				? error
				: new Error(error instanceof Error ? "ingest failed" : String(error));
		}
	});

const demoRecall = createServerFn({ method: "POST" })
	.validator((data: { query: string }) => data)
	.handler(async ({ data }) => {
		const agent = env.MemoryAgent.getByName(appUserId(env));
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
		<main className="page">
			<section>
				<h1 className="hero-heading">Memory that stays with your agents.</h1>
				<p className="hero-sub">
					Connect sources, extract memories, chat with them, and share the same store with Cursor or
					Claude over MCP.
				</p>
				<div className="flex flex-wrap gap-3">
					<Link to="/chat" className="ui-btn">
						Open chat
					</Link>
					<Link to="/sources" className="ui-btn-ghost">
						Connect a source
					</Link>
				</div>
			</section>

			<section className="ui-card mt-16">
				<h2 className="section-heading">MemoryAgent</h2>
				<p className="mt-2 text-sm text-[var(--muted)]">
					Ingest runs fetch → normalize → chunk → embed → extract → consolidate → commit. Hybrid
					search fuses Vectorize with DO SQLite FTS5.
				</p>
				<p className="mt-4 font-mono text-sm">{hello.message}</p>
				<p className="mt-1 text-sm text-[var(--muted)]">
					{hello.ready ? "Ready" : "Starting"} · {hello.userId}
				</p>
			</section>

			<section className="mt-8 grid gap-4 md:grid-cols-2">
				<form
					className="ui-card"
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
					<h2 className="section-heading">Ingest</h2>
					<p className="mt-2 text-sm text-[var(--muted)]">
						Write a note into this Worker’s memory.
					</p>
					<label className="mt-4 flex flex-col gap-2 text-sm">
						<span className="text-[var(--muted)]">Title</span>
						<input
							className="ui-field"
							value={ingestTitle}
							onChange={(event) => setIngestTitle(event.target.value)}
							name="title"
						/>
					</label>
					<label className="mt-3 flex flex-col gap-2 text-sm">
						<span className="text-[var(--muted)]">Markdown</span>
						<textarea
							className="ui-field min-h-32"
							value={ingestMarkdown}
							onChange={(event) => setIngestMarkdown(event.target.value)}
							name="markdown"
						/>
					</label>
					<button
						className="ui-btn mt-4"
						disabled={ingestBusy || ingestMarkdown.trim().length === 0}
						type="submit"
					>
						{ingestBusy ? "Ingesting…" : "Ingest"}
					</button>
					{ingestResult ? <pre className="ui-pre mt-4">{ingestResult}</pre> : null}
				</form>

				<form
					className="ui-card"
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
					<h2 className="section-heading">Recall</h2>
					<p className="mt-2 text-sm text-[var(--muted)]">
						Hybrid recall with rerank, same path as MCP.
					</p>
					<label className="mt-4 flex flex-col gap-2 text-sm">
						<span className="text-[var(--muted)]">Query</span>
						<input
							className="ui-field"
							value={recallQuery}
							onChange={(event) => setRecallQuery(event.target.value)}
							name="query"
						/>
					</label>
					<button
						className="ui-btn mt-4"
						disabled={recallBusy || recallQuery.trim().length === 0}
						type="submit"
					>
						{recallBusy ? "Recalling…" : "Recall"}
					</button>
					{recallResult ? <pre className="ui-pre mt-4">{recallResult}</pre> : null}
				</form>
			</section>

			<section className="mt-8 grid gap-4 md:grid-cols-2">
				<div className="ui-card">
					<h2 className="section-heading">MCP</h2>
					<p className="mt-2 text-sm text-[var(--muted)]">
						OAuth at <code>/authorize</code>. Manage grants on{" "}
						<Link className="ui-link" to="/agents">
							Agents
						</Link>
						.
					</p>
					<p className="mt-3 font-mono text-sm">/mcp</p>
				</div>
				<div className="ui-card">
					<h2 className="section-heading">LLM</h2>
					<p className="mt-2 text-sm text-[var(--muted)]">
						Chat is Luna high via {DEFAULT_LLM_PROVIDER}, with {FALLBACK_LLM_PROVIDER} as fallback.
					</p>
					<p className="mt-3 font-mono text-sm">
						{defaultLlmConfig.chat.model}/{defaultLlmConfig.chat.effort}
					</p>
				</div>
			</section>
		</main>
	);
}
