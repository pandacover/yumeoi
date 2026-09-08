import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { MEMORY_KINDS, type MemoryHit, type MemoryKind, type SourceView } from "@yumeoi/domain";
import { useMemo, useState } from "react";
import { appUserId } from "../api/sources.ts";

const getMemories = createServerFn({ method: "POST" })
	.validator((data: { query: string; kinds: MemoryKind[]; sources: string[] }) => data)
	.handler(async ({ data }) => {
		const userId = appUserId(env);
		const agent = env.MemoryAgent.getByName(userId);
		const [memories, sources] = await Promise.all([
			agent.browseMemories({
				query: data.query,
				kinds: data.kinds,
				sources: data.sources,
				limit: 50,
			}),
			agent.listSources(),
		]);
		return { memories, sources };
	});

export const Route = createFileRoute("/memories")({
	loader: () => getMemories({ data: { query: "", kinds: [], sources: [] } }),
	component: MemoriesPage,
});

function MemoriesPage() {
	const initial = Route.useLoaderData();
	const [query, setQuery] = useState("");
	const [kinds, setKinds] = useState<MemoryKind[]>([]);
	const [sources, setSources] = useState<string[]>([]);
	const [hits, setHits] = useState<MemoryHit[]>(initial.memories);
	const [sourceList, setSourceList] = useState<SourceView[]>(initial.sources);
	const [selected, setSelected] = useState<MemoryHit | null>(null);
	const [documentText, setDocumentText] = useState("");
	const [busy, setBusy] = useState(false);

	const load = async (next = { query, kinds, sources }) => {
		setBusy(true);
		try {
			const result = await getMemories({ data: next });
			setHits(result.memories);
			setSourceList(result.sources);
		} finally {
			setBusy(false);
		}
	};

	const openProvenance = async (hit: MemoryHit) => {
		setSelected(hit);
		const first = hit.provenance[0];
		if (!first) {
			setDocumentText("");
			return;
		}
		const result = await getDocument({ data: { id: first.documentId } });
		setDocumentText(result);
	};

	const kindsLabel = useMemo(() => kinds.join(", ") || "all kinds", [kinds]);

	return (
		<main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12">
			<header className="flex flex-col gap-3">
				<p className="text-sm tracking-[0.2em] text-[var(--accent)] uppercase">M2 memories</p>
				<h1 className="text-3xl font-semibold tracking-tight">Memories</h1>
				<p className="max-w-2xl text-[var(--muted)]">
					Search extracted memories and open provenance back to the source document.
				</p>
			</header>

			<form
				className="grid gap-4 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6"
				onSubmit={async (event) => {
					event.preventDefault();
					await load();
				}}
			>
				<label className="flex flex-col gap-2 text-sm">
					<span className="text-[var(--muted)]">Query</span>
					<input
						className="rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Effect 4, Workflows, …"
						name="query"
					/>
				</label>
				<div className="flex flex-wrap gap-2">
					{MEMORY_KINDS.map((kind) => {
						const on = kinds.includes(kind);
						return (
							<button
								key={kind}
								type="button"
								className={`rounded-full border px-3 py-1 text-xs ${
									on
										? "border-[var(--accent)] text-[var(--accent)]"
										: "border-[var(--line)] text-[var(--muted)]"
								}`}
								onClick={() =>
									setKinds((current) =>
										current.includes(kind)
											? current.filter((item) => item !== kind)
											: [...current, kind],
									)
								}
							>
								{kind}
							</button>
						);
					})}
				</div>
				{sourceList.length > 0 ? (
					<div className="flex flex-wrap gap-2">
						{sourceList.map((source) => {
							const on = sources.includes(source.id);
							return (
								<button
									key={source.id}
									type="button"
									className={`rounded-full border px-3 py-1 text-xs ${
										on
											? "border-[var(--accent)] text-[var(--accent)]"
											: "border-[var(--line)] text-[var(--muted)]"
									}`}
									onClick={() =>
										setSources((current) =>
											current.includes(source.id)
												? current.filter((item) => item !== source.id)
												: [...current, source.id],
										)
									}
								>
									{source.label}
								</button>
							);
						})}
					</div>
				) : null}
				<button
					className="w-fit rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--bg)] disabled:opacity-50"
					disabled={busy}
					type="submit"
				>
					{busy ? "Searching…" : "Search"}
				</button>
				<p className="text-sm text-[var(--muted)]">filter {kindsLabel}</p>
			</form>

			<section className="grid gap-4 lg:grid-cols-2">
				<div className="flex flex-col gap-3">
					{hits.length === 0 ? (
						<p className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6 text-[var(--muted)]">
							No memories yet. Ingest a document or connect a source.
						</p>
					) : (
						hits.map((hit) => (
							<button
								key={hit.memory.id}
								type="button"
								className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 text-left"
								onClick={() => void openProvenance(hit)}
							>
								<p className="text-xs uppercase tracking-wide text-[var(--accent)]">
									{hit.memory.kind}
								</p>
								<p className="mt-2">{hit.memory.text}</p>
								<p className="mt-3 text-sm text-[var(--muted)]">
									{hit.provenance[0]?.title ?? "no provenance"}
									{hit.provenance[0]?.url ? ` · ${hit.provenance[0].url}` : ""}
								</p>
							</button>
						))
					)}
				</div>
				{selected ? (
					<aside className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
						<h2 className="text-lg font-medium">Provenance</h2>
						<p className="mt-2 text-sm text-[var(--muted)]">{selected.memory.text}</p>
						<ul className="mt-4 flex flex-col gap-2 text-sm">
							{selected.provenance.map((item) => (
								<li key={`${item.documentId}:${item.chunkId}`}>
									<p>{item.title}</p>
									{item.url ? (
										<a className="text-[var(--accent)]" href={item.url}>
											{item.url}
										</a>
									) : (
										<p className="text-[var(--muted)]">{item.documentId}</p>
									)}
								</li>
							))}
						</ul>
						{documentText ? (
							<pre className="mt-4 overflow-x-auto whitespace-pre-wrap text-xs text-[var(--muted)]">
								{documentText}
							</pre>
						) : null}
					</aside>
				) : null}
			</section>
		</main>
	);
}

const getDocument = createServerFn({ method: "POST" })
	.validator((data: { id: string }) => data)
	.handler(async ({ data }) => {
		const document = await env.MemoryAgent.getByName(appUserId(env)).getDocument(data.id);
		return document.markdown;
	});
