import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
	type GatewayLlmProvider,
	makeMemoryAgentRuntime,
	readUsableBinding,
	resolveGatewayLlmProvidersFromKeys,
} from "@yumeoi/cf-runtime";
import type {
	AddMemoryRequest,
	ChatCitation,
	IngestRequest,
	IngestResult,
	MemoryHit,
	MemoryKind,
	RecallResult,
	Source,
	SourceView,
} from "@yumeoi/domain";
import { defaultLlmConfig } from "@yumeoi/domain";
import {
	addMemory,
	CHAT_SYSTEM_PROMPT,
	changesSince,
	citationsFromRecall,
	forgetMemories,
	getEntityView,
	getMemoryDetail,
	heuristicChatAnswer,
	IDLE_CANCEL_MS,
	type IngestState,
	type IngestStepName,
	ingestDocument,
	initialIngestState,
	lastUserText,
	listEntityIndex,
	loadDocument,
	MemoryRepo,
	profileLines,
	recallContext,
	recordChatEpisode,
	recordFeedback,
	reindexStore,
	remember,
	restoreArchivedMemory,
	runIngestStep,
	runLayerJobs,
	SWEEP_INTERVAL_SECONDS,
	searchMemories,
	sweepStore,
	timelineAbout,
	updateMemoryRecord,
} from "@yumeoi/memory";
import { callable } from "agents";
import {
	convertToModelMessages,
	type GenerateTextOnFinishCallback,
	isStepCount,
	streamText,
	type ToolSet,
} from "ai";
import { Effect } from "effect";
import { chatLanguageModel, chatProviderOptions } from "../chat/model.ts";
import { heuristicChatResponse } from "../chat/stream.ts";
import { createMemoryChatTools } from "../chat/tools.ts";

export type MemoryAgentState = {
	ready: boolean;
	lastIngest?: IngestResult;
	sources: SourceView[];
	ingestProgress?: { step: string; percent: number; sourceId?: string };
	lastActivityAt?: number;
	sweepArmed?: boolean;
};

type AgentRuntime = ReturnType<typeof makeMemoryAgentRuntime>;

type FilterKind = MemoryKind;

const causeText = (cause: unknown): string => {
	if (cause instanceof Error && cause.message.trim()) {
		return cause.message;
	}
	if (typeof cause === "string" && cause.trim()) {
		return cause;
	}
	return "";
};

/** HTTP `/ingest` and SourceAgent batch-wait. Large pages can exceed the old 180s cap. */
export const INGEST_WORKFLOW_TIMEOUT_MS = 15 * 60 * 1000;

const publicError = (error: unknown): Error => {
	if (error instanceof Error && error.message.trim()) {
		return error;
	}
	if (error && typeof error === "object" && "_tag" in error) {
		const tagged = error as {
			_tag: string;
			message?: string;
			provider?: string;
			cause?: unknown;
		};
		const detail = tagged.message || causeText(tagged.cause) || tagged.provider || "";
		return new Error(detail ? `${tagged._tag}: ${detail}` : tagged._tag);
	}
	const text = String(error);
	return new Error(text && text !== "[object Object]" ? text : "ingest failed");
};

export class MemoryAgent extends AIChatAgent<Env, MemoryAgentState> {
	override initialState: MemoryAgentState = { ready: false, sources: [] };
	override maxPersistedMessages = 200;
	override waitForMcpConnections = false;

	#runtime!: AgentRuntime;
	#providers: ReadonlyArray<GatewayLlmProvider> = [];

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		void ctx.blockConcurrencyWhile(async () => {
			try {
				const providers = resolveGatewayLlmProvidersFromKeys({
					openrouterApiKey: env.OPENROUTER_API_KEY,
					openaiApiKey: env.OPENAI_API_KEY,
				});
				this.#providers = providers;
				const ai = readUsableBinding(() => env.AI, "run");
				const vectorize = readUsableBinding(() => env.VECTORIZE, "query");
				const docs = readUsableBinding(() => env.DOCS, "put");
				this.#runtime = makeMemoryAgentRuntime({
					storage: ctx.storage,
					...(ai ? { ai } : {}),
					...(vectorize ? { vectorize } : {}),
					...(docs ? { docs } : {}),
					...(providers.length > 0 ? { providers } : {}),
				});
				await this.#runtime.context();
				this.setState({ ...this.state, ready: true });
				if (this.state.sweepArmed) {
					await this.scheduleEvery(SWEEP_INTERVAL_SECONDS, "sweep");
				}
			} catch (error) {
				console.error("MemoryAgent init failed", error);
				throw error;
			}
		});
	}

	override async onChatMessage(
		onFinish: GenerateTextOnFinishCallback<ToolSet>,
		options?: OnChatMessageOptions,
	) {
		const query = lastUserText(this.messages);
		if (this.#providers.length === 0) {
			return this.#heuristicChat(query);
		}

		const tools = createMemoryChatTools(this);
		const profile = await this.#runtime.runPromise(profileLines(this.name)).catch(() => "");
		const system = profile
			? `${CHAT_SYSTEM_PROMPT}\n\nStable user profile (semantic only; not a recall citation):\n${profile}`
			: CHAT_SYSTEM_PROMPT;
		const wrappedFinish: GenerateTextOnFinishCallback<ToolSet> = async (event) => {
			await onFinish(event);
			const userText = lastUserText(this.messages);
			if (userText) {
				await this.#runtime
					.runPromise(recordChatEpisode(this.name, userText))
					.catch(() => undefined);
			}
		};
		let lastError: unknown;
		for (const provider of this.#providers) {
			try {
				const result = streamText({
					model: chatLanguageModel(provider, defaultLlmConfig.chat),
					system,
					messages: await convertToModelMessages(this.messages),
					tools,
					stopWhen: isStepCount(5),
					onFinish: wrappedFinish,
					...(options?.abortSignal ? { abortSignal: options.abortSignal } : {}),
					providerOptions: chatProviderOptions(defaultLlmConfig.chat.effort),
				});
				return result.toUIMessageStreamResponse();
			} catch (error) {
				lastError = error;
				console.error(`chat provider ${provider.provider} failed`, error);
			}
		}
		console.error("chat providers exhausted", lastError);
		return this.#heuristicChat(query);
	}

	async #heuristicChat(query: string) {
		if (query) {
			await this.#runtime.runPromise(recordChatEpisode(this.name, query)).catch(() => undefined);
		}
		const { text, citations } = await this.answerQuestion(query);
		return heuristicChatResponse(text, citations);
	}

	async #touch(now = Date.now()) {
		const next = { ...this.state, lastActivityAt: now };
		if (!this.state.sweepArmed) {
			await this.scheduleEvery(SWEEP_INTERVAL_SECONDS, "sweep");
			next.sweepArmed = true;
		}
		this.setState(next);
	}

	async #cancelSweepSchedules() {
		const schedules = await this.listSchedules();
		for (const item of schedules) {
			if (item.callback === "sweep") {
				await this.cancelSchedule(item.id);
			}
		}
		this.setState({ ...this.state, sweepArmed: false });
	}

	@callable()
	async answerQuestion(query: string): Promise<{ text: string; citations: ChatCitation[] }> {
		const result = await this.recall({
			query: query.trim() || "recent memories",
			rerank: true,
		});
		return heuristicChatAnswer(query, citationsFromRecall(result));
	}

	@callable()
	async startChatTurn(text: string) {
		return this.saveMessages((messages) => [
			...messages,
			{
				id: crypto.randomUUID(),
				role: "user",
				parts: [{ type: "text", text }],
			},
		]);
	}

	@callable()
	listChatMessages() {
		return this.messages;
	}

	@callable()
	hello(name = "horizon"): { message: string; ready: boolean } {
		return {
			message: `hello ${name}`,
			ready: this.state.ready,
		};
	}

	@callable()
	async pingFts(query: string): Promise<{ matches: Array<{ id: string; text: string }> }> {
		return this.#runtime.runPromise(
			Effect.gen(function* () {
				const repo = yield* MemoryRepo;
				yield* ingestDocument({
					userId: "demo",
					request: {
						externalId: "fts-ping",
						title: "FTS ping",
						markdown: "horizon stores memories in Durable Object SQLite with FTS5.",
						sourceId: "generic",
						sourceLabel: "Ping",
						url: null,
					},
				});
				const hits = yield* repo.searchMemoryFts(`"${query.replaceAll('"', "")}"`, {
					sources: [],
					kinds: [],
					since: null,
					limit: 10,
				});
				const memories = yield* repo.listMemoriesByIds(hits.map((hit) => hit.id));
				return { matches: memories.map((memory) => ({ id: memory.id, text: memory.text })) };
			}),
		);
	}

	@callable()
	async ingest(request: IngestRequest): Promise<IngestResult> {
		try {
			await this.#touch();
			const result = await this.#runtime.runPromise(ingestDocument({ userId: this.name, request }));
			this.setState({ ...this.state, lastIngest: result });
			return result;
		} catch (error) {
			throw publicError(error);
		}
	}

	@callable()
	async beginIngest(request: IngestRequest): Promise<IngestState> {
		try {
			return await this.#runtime.runPromise(
				runIngestStep("fetch", initialIngestState({ userId: this.name, request })),
			);
		} catch (error) {
			throw publicError(error);
		}
	}

	@callable()
	async continueIngest(
		name: Exclude<IngestStepName, "fetch">,
		state: IngestState,
	): Promise<IngestState> {
		try {
			return await this.#runtime.runPromise(runIngestStep(name, state));
		} catch (error) {
			throw publicError(error);
		}
	}

	@callable()
	async enqueueIngest(
		request: IngestRequest,
	): Promise<{ instanceId?: string; pending: boolean; result?: IngestResult }> {
		try {
			if (!this.env.INGEST_WORKFLOW) {
				const result = await this.ingest(request);
				return { pending: false, result };
			}
			const instanceId = await this.runWorkflow("INGEST_WORKFLOW", {
				userId: this.name,
				request,
			});
			return { instanceId, pending: true };
		} catch (error) {
			throw publicError(error);
		}
	}

	@callable()
	async waitForIngest(
		instanceId: string,
		timeoutMs = INGEST_WORKFLOW_TIMEOUT_MS,
	): Promise<IngestResult> {
		try {
			const result = await this.#waitForIngestWorkflow(instanceId, timeoutMs);
			this.setState({ ...this.state, lastIngest: result });
			return result;
		} catch (error) {
			throw publicError(error);
		}
	}

	@callable()
	async startIngest(request: IngestRequest): Promise<IngestResult & { instanceId?: string }> {
		try {
			const queued = await this.enqueueIngest(request);
			if (!queued.pending) {
				return queued.result ?? (await this.ingest(request));
			}
			const instanceId = queued.instanceId ?? "";
			const result = await this.waitForIngest(instanceId);
			return { ...result, instanceId };
		} catch (error) {
			throw publicError(error);
		}
	}

	async #waitForIngestWorkflow(
		instanceId: string,
		timeoutMs = INGEST_WORKFLOW_TIMEOUT_MS,
	): Promise<IngestResult> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const status = await this.getWorkflowStatus("INGEST_WORKFLOW", instanceId);
			if (status.status === "complete") {
				if (status.output && typeof status.output === "object" && "documentId" in status.output) {
					return status.output as IngestResult;
				}
				if (this.state.lastIngest) {
					return this.state.lastIngest;
				}
			}
			if (status.status === "errored" || status.status === "terminated") {
				const message =
					typeof status.error === "string"
						? status.error
						: status.error
							? JSON.stringify(status.error)
							: `ingest workflow ${status.status}`;
				throw new Error(message);
			}
			await scheduler.wait(250);
		}
		throw new Error(`ingest workflow ${instanceId} timed out`);
	}

	@callable()
	async search(query: {
		query: string;
		sources?: ReadonlyArray<string>;
		kinds?: ReadonlyArray<FilterKind>;
		types?: ReadonlyArray<string>;
		since?: number | null;
		from?: number | null;
		to?: number | null;
		asOf?: number | null;
		entities?: ReadonlyArray<string>;
		limit?: number;
		includeDormant?: boolean;
	}) {
		await this.#touch();
		return this.#runtime.runPromise(
			searchMemories({
				query: query.query,
				sources: query.sources ? [...query.sources] : [],
				kinds: query.kinds ? [...query.kinds] : [],
				since: query.since ?? query.from ?? null,
				limit: query.limit ?? 20,
				namespace: this.name,
				...(query.types ? { types: query.types as never } : {}),
				...(query.from !== undefined ? { from: query.from } : {}),
				...(query.to !== undefined ? { to: query.to } : {}),
				...(query.asOf !== undefined ? { asOf: query.asOf } : {}),
				...(query.entities ? { entities: [...query.entities] } : {}),
				...(query.includeDormant !== undefined ? { includeDormant: query.includeDormant } : {}),
			}),
		);
	}

	@callable()
	async recall(query: {
		query: string;
		sources?: ReadonlyArray<string>;
		kinds?: ReadonlyArray<FilterKind>;
		types?: ReadonlyArray<string>;
		since?: number | null;
		from?: number | null;
		to?: number | null;
		asOf?: number | null;
		entities?: ReadonlyArray<string>;
		include?: ReadonlyArray<string>;
		format?: "markdown" | "json";
		plan?: "fast" | "full";
		budgetTokens?: number;
		rerank?: boolean;
		rerankMode?: "none" | "cross" | "llm";
	}): Promise<RecallResult> {
		await this.#touch();
		return this.#runtime.runPromise(
			recallContext({
				query: query.query,
				sources: query.sources ? [...query.sources] : [],
				kinds: query.kinds ? [...query.kinds] : [],
				since: query.since ?? query.from ?? null,
				budgetTokens: query.budgetTokens ?? 1500,
				rerank: query.rerank ?? true,
				namespace: this.name,
				...(query.types ? { types: query.types as never } : {}),
				...(query.from !== undefined ? { from: query.from } : {}),
				...(query.to !== undefined ? { to: query.to } : {}),
				...(query.asOf !== undefined ? { asOf: query.asOf } : {}),
				...(query.entities ? { entities: [...query.entities] } : {}),
				...(query.include ? { include: query.include as never } : {}),
				...(query.format ? { format: query.format } : {}),
				...(query.plan ? { plan: query.plan } : {}),
				...(query.rerankMode ? { rerankMode: query.rerankMode } : {}),
			}),
		);
	}

	@callable()
	async getMemory(id: string) {
		return this.#runtime.runPromise(Effect.flatMap(MemoryRepo, (repo) => repo.getMemory(id)));
	}

	@callable()
	async getDocument(id: string) {
		return this.#runtime.runPromise(loadDocument(id));
	}

	@callable()
	async addMemory(input: AddMemoryRequest) {
		const userId = this.name;
		const request = input.sourceId ? input : { ...input, sourceId: `agent:${userId}` };
		return this.#runtime.runPromise(addMemory(userId, request));
	}

	@callable()
	async remember(input: {
		text?: string;
		items?: ReadonlyArray<{
			text: string;
			type?: string;
			kind?: string;
			importance?: number;
			eventAt?: string | null;
			validFrom?: string | null;
			clientRef?: string;
		}>;
		dedupe?: boolean;
		mode?: "extract" | "verbatim";
		sourceId?: string;
		origin?: "extracted" | "agent" | "user" | "derived" | "chat";
		observedAt?: number | null;
	}) {
		await this.#touch();
		return this.#runtime.runPromise(
			remember({
				userId: this.name,
				dedupe: input.dedupe ?? true,
				mode: input.mode ?? "verbatim",
				sourceId: input.sourceId ?? `agent:${this.name}`,
				...(input.text !== undefined ? { text: input.text } : {}),
				...(input.items !== undefined ? { items: input.items as never } : {}),
				...(input.origin ? { origin: input.origin } : {}),
				...(input.observedAt !== undefined ? { observedAt: input.observedAt } : {}),
			}),
		);
	}

	@callable()
	async updateMemory(input: {
		id: string;
		text?: string;
		validTo?: string | null;
		importance?: number;
		kind?: MemoryKind;
		eventAt?: string | null;
	}) {
		return this.#runtime.runPromise(
			updateMemoryRecord({
				id: input.id,
				namespace: this.name,
				...(input.text !== undefined ? { text: input.text } : {}),
				...(input.validTo !== undefined ? { validTo: input.validTo } : {}),
				...(input.importance !== undefined ? { importance: input.importance } : {}),
				...(input.kind !== undefined ? { kind: input.kind } : {}),
				...(input.eventAt !== undefined ? { eventAt: input.eventAt } : {}),
			}),
		);
	}

	@callable()
	async forget(input: { id?: string; query?: string; confirm?: boolean; reason?: string }) {
		await this.#touch();
		return this.#runtime.runPromise(
			forgetMemories({
				userId: this.name,
				...(input.id !== undefined ? { id: input.id } : {}),
				...(input.query !== undefined ? { query: input.query } : {}),
				...(input.confirm !== undefined ? { confirm: input.confirm } : {}),
				...(input.reason !== undefined ? { reason: input.reason } : {}),
			}),
		);
	}

	@callable()
	async feedback(input: {
		id: string;
		signal: 1 | -1;
		note?: string;
		query?: string;
		clientId?: string;
	}) {
		await this.#touch();
		return this.#runtime.runPromise(
			recordFeedback({
				id: input.id,
				signal: input.signal,
				clientId: input.clientId ?? this.name,
				namespace: this.name,
				...(input.note !== undefined ? { note: input.note } : {}),
				...(input.query !== undefined ? { query: input.query } : {}),
			}),
		);
	}

	@callable()
	async getMemoryDetail(id: string) {
		return this.#runtime.runPromise(getMemoryDetail(id));
	}

	@callable()
	async getEntity(input: {
		name?: string | undefined;
		id?: string | undefined;
		hops?: number | undefined;
	}) {
		return this.#runtime.runPromise(
			getEntityView({
				namespace: this.name,
				...(input.name !== undefined ? { name: input.name } : {}),
				...(input.id !== undefined ? { id: input.id } : {}),
				...(input.hops !== undefined ? { hops: input.hops } : {}),
			}),
		);
	}

	@callable()
	async timeline(input: {
		about: string;
		from?: number | null;
		to?: number | null;
		limit?: number;
	}) {
		return this.#runtime.runPromise(
			timelineAbout({
				userId: this.name,
				about: input.about,
				from: input.from ?? null,
				to: input.to ?? null,
				limit: input.limit ?? 20,
			}),
		);
	}

	@callable()
	async changesSince(since: number) {
		return this.#runtime.runPromise(changesSince(since));
	}

	@callable()
	async splitEntity(input: { id: string; newName: string }) {
		return this.#runtime.runPromise(
			Effect.flatMap(MemoryRepo, (repo) => repo.splitEntity(input.id, input.newName)),
		);
	}

	@callable()
	async promote() {
		return this.#runtime.runPromise(runLayerJobs(this.name));
	}

	@callable()
	async profile() {
		return this.#runtime.runPromise(profileLines(this.name));
	}

	@callable()
	async entityIndex() {
		return this.#runtime.runPromise(listEntityIndex());
	}

	@callable()
	async reindex() {
		await this.#touch();
		return this.#runtime.runPromise(reindexStore(this.name));
	}

	@callable()
	async sweep(payload?: { cursor?: string | null; now?: number; maxActive?: number }) {
		const now = payload?.now ?? Date.now();
		// Idle-cancel only applies to the repeating scheduled job (no explicit `now`).
		// RPC / admin / tests pass `now` and must still run.
		if (payload?.now === undefined) {
			const lastActivity = this.state.lastActivityAt ?? now;
			if (now - lastActivity >= IDLE_CANCEL_MS) {
				await this.#cancelSweepSchedules();
				return {
					cancelled: true,
					scanned: 0,
					dormanted: [],
					archived: [],
					forgotten: [],
					merged: [],
					budgeted: [],
					vectorsDeleted: [],
					stats: await this.memoryStats(),
					nextCursor: null,
					done: true,
				};
			}
		}
		const result = await this.#runtime.runPromise(
			sweepStore({
				userId: this.name,
				now,
				cursor: payload?.cursor ?? null,
				...(payload?.maxActive !== undefined ? { maxActive: payload.maxActive } : {}),
			}),
		);
		if (result.nextCursor) {
			await this.schedule(1, "sweep", { cursor: result.nextCursor, now });
		}
		return result;
	}

	@callable()
	async restoreMemory(id: string) {
		await this.#touch();
		return this.#runtime.runPromise(restoreArchivedMemory(id, this.name));
	}

	@callable()
	async memoryStats() {
		return this.#runtime.runPromise(Effect.flatMap(MemoryRepo, (repo) => repo.getStats()));
	}

	@callable()
	async listArchived(limit = 20) {
		return this.#runtime.runPromise(Effect.flatMap(MemoryRepo, (repo) => repo.listArchived(limit)));
	}

	@callable()
	async listSources() {
		const userId = this.name;
		const rows = await this.#runtime.runPromise(
			Effect.flatMap(MemoryRepo, (repo) => repo.listSources(userId)),
		);
		const live = new Map(this.state.sources.map((source) => [source.id, source]));
		const merged = new Map<string, SourceView>();
		for (const row of rows) {
			merged.set(row.id, live.get(row.id) ?? idleSource(row));
		}
		for (const source of this.state.sources) {
			merged.set(source.id, source);
		}
		return [...merged.values()];
	}

	@callable()
	async registerSource(source: Source): Promise<SourceView> {
		await this.#runtime.runPromise(Effect.flatMap(MemoryRepo, (repo) => repo.upsertSource(source)));
		const view = this.state.sources.find((item) => item.id === source.id) ?? idleSource(source);
		const next = { ...view, label: source.label, kind: source.kind };
		this.setState({
			...this.state,
			sources: upsertSourceView(this.state.sources, next),
		});
		return next;
	}

	@callable()
	async reportSourceStatus(source: SourceView): Promise<SourceView> {
		await this.#runtime.runPromise(
			Effect.flatMap(MemoryRepo, (repo) =>
				repo.upsertSource({
					id: source.id,
					userId: source.userId,
					kind: source.kind,
					label: source.label,
				}),
			),
		);
		this.setState({
			...this.state,
			sources: upsertSourceView(this.state.sources, source),
		});
		return source;
	}

	@callable()
	async getDocumentHash(sourceId: string, externalId: string): Promise<string | null> {
		const document = await this.#runtime.runPromise(
			Effect.flatMap(MemoryRepo, (repo) => repo.getDocumentByExternalId(sourceId, externalId)),
		);
		return document?.contentHash ?? null;
	}

	@callable()
	async listRecentMemories(limit = 20) {
		return this.#runtime.runPromise(
			Effect.flatMap(MemoryRepo, (repo) => repo.listRecentMemories(limit)),
		);
	}

	@callable()
	async browseMemories(query: {
		query?: string;
		sources?: ReadonlyArray<string>;
		kinds?: ReadonlyArray<FilterKind>;
		since?: number | null;
		limit?: number;
	}): Promise<MemoryHit[]> {
		await this.#touch();
		const sources = query.sources ? [...query.sources] : [];
		const kinds = query.kinds ? [...query.kinds] : [];
		const since = query.since ?? null;
		const limit = query.limit ?? 40;
		if (query.query && query.query.trim().length > 0) {
			return this.search({
				query: query.query,
				sources,
				kinds,
				since,
				limit,
			});
		}
		return this.#runtime.runPromise(
			Effect.gen(function* () {
				const repo = yield* MemoryRepo;
				const memories = yield* repo.listMemories({ sources, kinds, since, limit });
				const provenances = yield* repo.provenanceFor(memories.map((memory) => memory.id));
				const byMemory = new Map<string, Array<MemoryHit["provenance"][number]>>();
				for (const row of provenances) {
					const list = byMemory.get(row.memoryId) ?? [];
					byMemory.set(row.memoryId, [
						...list,
						{
							sourceId: row.sourceId,
							documentId: row.documentId,
							chunkId: row.chunkId,
							title: row.title,
							url: row.url,
						},
					]);
				}
				return memories.map((memory) => ({
					memory,
					score: 1,
					provenance: byMemory.get(memory.id) ?? [],
				}));
			}),
		);
	}

	override async onWorkflowProgress(
		_workflowName: string,
		_workflowId: string,
		progress: unknown,
	): Promise<void> {
		if (!progress || typeof progress !== "object") {
			return;
		}
		const record = progress as { step?: string; percent?: number; sourceId?: string };
		if (typeof record.step === "string") {
			this.setState({
				...this.state,
				ingestProgress: {
					step: record.step,
					percent: typeof record.percent === "number" ? record.percent : 0,
					...(typeof record.sourceId === "string" ? { sourceId: record.sourceId } : {}),
				},
			});
		}
	}

	override async onWorkflowComplete(
		_workflowName: string,
		_instanceId: string,
		result?: unknown,
	): Promise<void> {
		if (result && typeof result === "object" && "documentId" in result) {
			this.setState({ ...this.state, lastIngest: result as IngestResult });
		}
	}
}

const idleSource = (source: Source): SourceView => ({
	id: source.id,
	userId: source.userId,
	kind: source.kind,
	label: source.label,
	status: "idle",
	lastSyncedAt: null,
	lastError: null,
	documentsSeen: 0,
	documentsIngested: 0,
});

const upsertSourceView = (sources: ReadonlyArray<SourceView>, next: SourceView): SourceView[] => {
	const others = sources.filter((source) => source.id !== next.id);
	return [...others, next];
};
