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
	citationsFromRecall,
	heuristicChatAnswer,
	type IngestState,
	type IngestStepName,
	ingestDocument,
	initialIngestState,
	lastUserText,
	loadDocument,
	MemoryRepo,
	recallContext,
	runIngestStep,
	searchMemories,
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
		let lastError: unknown;
		for (const provider of this.#providers) {
			try {
				const result = streamText({
					model: chatLanguageModel(provider, defaultLlmConfig.chat),
					system: CHAT_SYSTEM_PROMPT,
					messages: await convertToModelMessages(this.messages),
					tools,
					stopWhen: isStepCount(5),
					onFinish,
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
		const { text, citations } = await this.answerQuestion(query);
		return heuristicChatResponse(text, citations);
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
	hello(name = "yumeoi"): { message: string; ready: boolean } {
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
						markdown: "yumeoi stores memories in Durable Object SQLite with FTS5.",
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
	async startIngest(request: IngestRequest): Promise<IngestResult & { instanceId?: string }> {
		try {
			if (!this.env.INGEST_WORKFLOW) {
				return this.ingest(request);
			}
			const instanceId = await this.runWorkflow("INGEST_WORKFLOW", {
				userId: this.name,
				request,
			});
			const result = await this.#waitForIngestWorkflow(instanceId);
			this.setState({ ...this.state, lastIngest: result });
			return { ...result, instanceId };
		} catch (error) {
			throw publicError(error);
		}
	}

	async #waitForIngestWorkflow(instanceId: string, timeoutMs = 180_000): Promise<IngestResult> {
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
			await scheduler.wait(50);
		}
		throw new Error(`ingest workflow ${instanceId} timed out`);
	}

	@callable()
	async search(query: {
		query: string;
		sources?: ReadonlyArray<string>;
		kinds?: ReadonlyArray<FilterKind>;
		since?: number | null;
		limit?: number;
	}) {
		return this.#runtime.runPromise(
			searchMemories({
				query: query.query,
				sources: query.sources ? [...query.sources] : [],
				kinds: query.kinds ? [...query.kinds] : [],
				since: query.since ?? null,
				limit: query.limit ?? 20,
				namespace: this.name,
			}),
		);
	}

	@callable()
	async recall(query: {
		query: string;
		sources?: ReadonlyArray<string>;
		kinds?: ReadonlyArray<FilterKind>;
		since?: number | null;
		budgetTokens?: number;
		rerank?: boolean;
	}): Promise<RecallResult> {
		return this.#runtime.runPromise(
			recallContext({
				query: query.query,
				sources: query.sources ? [...query.sources] : [],
				kinds: query.kinds ? [...query.kinds] : [],
				since: query.since ?? null,
				budgetTokens: query.budgetTokens ?? 2000,
				rerank: query.rerank ?? true,
				namespace: this.name,
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
