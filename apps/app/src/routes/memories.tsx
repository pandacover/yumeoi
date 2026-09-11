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
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { appUserId } from "../api/sources.ts";
import { Page, PageHeader } from "../components/page.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../components/ui/card.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty.tsx";
import { Field, FieldGroup, FieldLabel } from "../components/ui/field.tsx";
import { Input } from "../components/ui/input.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group.tsx";

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
	const queryId = useId();
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
		<Page wide>
			<PageHeader
				title="Memories"
				description="Search extracted memories and open provenance back to the source document."
			/>

			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				<Card size="sm">
					<CardHeader>
						<CardDescription>Active</CardDescription>
						<CardTitle>{stats.active}</CardTitle>
					</CardHeader>
				</Card>
				<Card size="sm">
					<CardHeader>
						<CardDescription>Dormant / archived</CardDescription>
						<CardTitle>
							{stats.dormant} / {stats.archived}
						</CardTitle>
					</CardHeader>
				</Card>
				<Card size="sm">
					<CardHeader>
						<CardDescription>Last sweep</CardDescription>
						<CardTitle>
							{stats.lastSweepAt
								? new Date(stats.lastSweepAt).toISOString().slice(0, 16).replace("T", " ")
								: "not yet"}
						</CardTitle>
						<CardDescription>vectors deleted {stats.vectorsDeleted}</CardDescription>
					</CardHeader>
				</Card>
			</div>

			<form
				className="flex flex-col gap-4"
				onSubmit={async (event) => {
					event.preventDefault();
					await load();
				}}
			>
				<FieldGroup>
					<Field>
						<FieldLabel htmlFor={queryId}>Query</FieldLabel>
						<Input
							id={queryId}
							name="query"
							placeholder="Macbook, Notion, Topic A, …"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
						/>
					</Field>
				</FieldGroup>
				<ToggleGroup
					multiple
					value={kinds}
					variant="outline"
					onValueChange={(next) => setKinds(next as MemoryKind[])}
				>
					{MEMORY_KINDS.map((kind) => (
						<ToggleGroupItem key={kind} value={kind}>
							{kind}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
				{sourceList.length > 0 ? (
					<ToggleGroup
						multiple
						value={sources}
						variant="outline"
						onValueChange={(next) => setSources(next)}
					>
						{sourceList.map((source) => (
							<ToggleGroupItem key={source.id} value={source.id}>
								{source.label}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				) : null}
				<Button className="w-fit" disabled={busy} type="submit">
					{busy ? <Spinner data-icon="inline-start" /> : null}
					{busy ? "Searching…" : "Search"}
				</Button>
				<p className="text-sm text-muted-foreground">filter {kindsLabel}</p>
			</form>

			<section className="grid gap-4 lg:grid-cols-2">
				<div className="flex flex-col gap-3">
					{hits.length === 0 ? (
						<Empty className="border">
							<EmptyHeader>
								<EmptyTitle>No memories yet</EmptyTitle>
								<EmptyDescription>Ingest a document or connect an integration.</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						hits.map((hit) => (
							<Button
								key={hit.memory.id}
								className="h-auto w-full flex-col items-start gap-2 whitespace-normal py-3"
								variant="outline"
								onClick={() => void openProvenance(hit)}
							>
								<Badge variant="secondary">{hit.memory.kind}</Badge>
								<p className="text-left text-sm">{hit.memory.text}</p>
								{hit.memory.entities.length > 0 ? (
									<div className="flex flex-wrap gap-1">
										{hit.memory.entities.map((entity) => (
											<Badge key={`${hit.memory.id}:${entity.id}`} variant="outline">
												{entity.name}
											</Badge>
										))}
									</div>
								) : null}
								<p className="text-left text-xs text-muted-foreground">
									{hit.provenance[0]?.title ?? "no provenance"}
									{hit.provenance[0]?.url ? ` · ${hit.provenance[0].url}` : ""}
								</p>
							</Button>
						))
					)}
				</div>
				{selected ? (
					<Card>
						<CardHeader>
							<CardTitle>Provenance</CardTitle>
							<CardDescription>{selected.memory.text}</CardDescription>
						</CardHeader>
						<CardContent className="flex flex-col gap-3">
							{selected.provenance.map((item) => (
								<div className="flex flex-col gap-1" key={`${item.documentId}:${item.chunkId}`}>
									<p className="text-sm">{item.title}</p>
									{item.url ? (
										<a
											className="break-all text-xs text-primary underline-offset-4 hover:underline"
											href={item.url}
										>
											{item.url}
										</a>
									) : (
										<p className="text-xs text-muted-foreground">{item.documentId}</p>
									)}
								</div>
							))}
							{documentText ? (
								<pre className="overflow-x-auto whitespace-pre-wrap bg-muted p-3 font-mono text-xs text-muted-foreground">
									{documentText}
								</pre>
							) : null}
						</CardContent>
					</Card>
				) : null}
			</section>

			{archived.length > 0 ? (
				<section className="flex flex-col gap-3">
					<h2 className="font-heading text-base font-medium">Archived</h2>
					<p className="text-sm text-muted-foreground">
						Archived memories are out of recall. Restore puts them back in the active set.
					</p>
					{archived.map((memory) => (
						<Card key={memory.id}>
							<CardHeader>
								<CardDescription>
									{memory.type} · {memory.kind}
								</CardDescription>
								<CardTitle>{memory.text}</CardTitle>
							</CardHeader>
							<CardContent>
								<Button
									disabled={busy}
									size="sm"
									variant="outline"
									onClick={async () => {
										setBusy(true);
										try {
											await restoreMemoryFn({ data: { id: memory.id } });
											await load();
											toast.success("Restored");
										} finally {
											setBusy(false);
										}
									}}
								>
									Restore
								</Button>
							</CardContent>
						</Card>
					))}
				</section>
			) : null}
		</Page>
	);
}

const getDocument = createServerFn({ method: "POST" })
	.validator((data: { id: string }) => data)
	.handler(async ({ data }) => {
		const document = await env.MemoryAgent.getByName(appUserId(env)).getDocument(data.id);
		return document.markdown;
	});
