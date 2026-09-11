import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
	MEMORY_KINDS,
	type Memory,
	type MemoryHit,
	type MemoryKind,
	type MemoryStats,
	type SourceView,
} from "@yumeoi/domain";
import { useMemo, useState } from "react";
import { appUserId } from "../api/sources.ts";

const getMemories = createServerFn({ method: "POST" })
	.validator((data: { query: string; kinds: MemoryKind[]; sources: string[] }) => data)
	.handler(async ({ data }) => {
		const userId = appUserId(env);
		const agent = env.MemoryAgent.getByName(userId);
		const [memories, sources, stats, archived] = await Promise.all([
			agent.browseMemories({
				query: data.query,
				kinds: data.kinds,
				sources: data.sources,
				limit: 50,
			}),
			agent.listSources(),
			agent.memoryStats(),
			agent.listArchived(12),
		]);
		return { memories, sources, stats, archived };
	});

const restoreMemoryFn = createServerFn({ method: "POST" })
	.validator((data: { id: string }) => data)
	.handler(async ({ data }) => {
		const userId = appUserId(env);
		return env.MemoryAgent.getByName(userId).restoreMemory(data.id);
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
	const [stats, setStats] = useState<MemoryStats>(initial.stats);
	const [archived, setArchived] = useState<Memory[]>([...initial.archived]);
	const [selected, setSelected] = useState<MemoryHit | null>(null);
	const [documentText, setDocumentText] = useState("");
	const [busy, setBusy] = useState(false);

	const load = async (next = { query, kinds, sources }) => {
		setBusy(true);
		try {
			const result = await getMemories({ data: next });
			setHits(result.memories);
			setSourceList(result.sources);
			setStats(result.stats);
			setArchived([...result.archived]);
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
		<main className="page page-wide">
			<header>
				<h1 className="hero-heading">Memories</h1>
				<p className="hero-sub">
					Search extracted memories and open provenance back to the source document.
				</p>
			</header>

			<section className="ui-card grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
				<div>
					<p className="stat-label">Active</p>
					<p className="stat-value">{stats.active}</p>
				</div>
				<div>
					<p className="stat-label">Dormant / archived</p>
					<p className="stat-value">
						{stats.dormant} / {stats.archived}
					</p>
				</div>
				<div>
					<p className="stat-label">Types</p>
					<p className="mt-1 text-sm text-[var(--muted)]">
						semantic {stats.semantic} · episodic {stats.episodic} · procedural {stats.procedural}
					</p>
				</div>
				<div>
					<p className="stat-label">Last sweep</p>
					<p className="mt-1 text-sm text-[var(--muted)]">
						{stats.lastSweepAt
							? new Date(stats.lastSweepAt).toISOString().slice(0, 16).replace("T", " ")
							: "not yet"}
					</p>
					<p className="text-xs text-[var(--muted)]">vectors deleted {stats.vectorsDeleted}</p>
				</div>
			</section>

			<form
				className="ui-card mt-8 grid gap-4"
				onSubmit={async (event) => {
					event.preventDefault();
					await load();
				}}
			>
				<label className="flex flex-col gap-2 text-sm">
					<span className="text-[var(--muted)]">Query</span>
					<input
						className="ui-field"
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
								className={on ? "ui-chip ui-chip-on" : "ui-chip"}
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
									className={on ? "ui-chip ui-chip-on" : "ui-chip"}
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
				<button className="ui-btn w-fit" disabled={busy} type="submit">
					{busy ? "Searching…" : "Search"}
				</button>
				<p className="text-sm text-[var(--muted)]">filter {kindsLabel}</p>
			</form>

			<section className="mt-8 grid gap-4 lg:grid-cols-2">
				<div className="flex flex-col gap-3">
					{hits.length === 0 ? (
						<p className="ui-card text-[var(--muted)]">
							No memories yet. Ingest a document or connect an integration.
						</p>
					) : (
						hits.map((hit) => (
							<button
								key={hit.memory.id}
								type="button"
								className="ui-card text-left"
								onClick={() => void openProvenance(hit)}
							>
								<p className="stat-label">{hit.memory.kind}</p>
								<p className="mt-2">{hit.memory.text}</p>
								{hit.memory.entities.length > 0 ? (
									<div className="mt-3 flex flex-wrap gap-1">
										{hit.memory.entities.map((entity) => (
											<span key={`${hit.memory.id}:${entity.id}`} className="ui-chip">
												{entity.name}
											</span>
										))}
									</div>
								) : null}
								<p className="mt-3 text-sm text-[var(--muted)]">
									{hit.provenance[0]?.title ?? "no provenance"}
									{hit.provenance[0]?.url ? ` · ${hit.provenance[0].url}` : ""}
								</p>
							</button>
						))
					)}
				</div>
				{selected ? (
					<aside className="ui-card">
						<h2 className="section-heading">Provenance</h2>
						<p className="mt-2 text-sm text-[var(--muted)]">{selected.memory.text}</p>
						<ul className="mt-4 flex flex-col gap-2 text-sm">
							{selected.provenance.map((item) => (
								<li key={`${item.documentId}:${item.chunkId}`}>
									<p>{item.title}</p>
									{item.url ? (
										<a className="ui-link break-all" href={item.url}>
											{item.url}
										</a>
									) : (
										<p className="text-[var(--muted)]">{item.documentId}</p>
									)}
								</li>
							))}
						</ul>
						{documentText ? (
							<pre className="ui-pre mt-4 whitespace-pre-wrap">{documentText}</pre>
						) : null}
					</aside>
				) : null}
			</section>

			{archived.length > 0 ? (
				<section className="mt-8 flex flex-col gap-3">
					<h2 className="section-heading">Archived</h2>
					<p className="text-sm text-[var(--muted)]">
						Archived memories are out of recall. Restore puts them back in the active set.
					</p>
					{archived.map((memory) => (
						<div key={memory.id} className="ui-card flex items-start justify-between gap-4">
							<div>
								<p className="stat-label">
									{memory.type} · {memory.kind}
								</p>
								<p className="mt-2">{memory.text}</p>
							</div>
							<button
								type="button"
								className="ui-btn-ghost shrink-0"
								disabled={busy}
								onClick={async () => {
									setBusy(true);
									try {
										await restoreMemoryFn({ data: { id: memory.id } });
										await load();
									} finally {
										setBusy(false);
									}
								}}
							>
								Restore
							</button>
						</div>
					))}
				</section>
			) : null}
		</main>
	);
}

const getDocument = createServerFn({ method: "POST" })
	.validator((data: { id: string }) => data)
	.handler(async ({ data }) => {
		const document = await env.MemoryAgent.getByName(appUserId(env)).getDocument(data.id);
		return document.markdown;
	});
