import { makeMemoryAgentRuntime } from "@yumeoi/cf-runtime";
import type {
	AddMemoryRequest,
	IngestRequest,
	IngestResult,
	MemoryKind,
	RecallResult,
} from "@yumeoi/domain";
import { ingestDocument, MemoryRepo, recallContext, searchMemories } from "@yumeoi/memory";
import { Agent, callable } from "agents";
import { Effect } from "effect";

export type MemoryAgentState = {
	ready: boolean;
	lastIngest?: IngestResult;
};

type AgentRuntime = ReturnType<typeof makeMemoryAgentRuntime>;

type FilterKind = MemoryKind;

export class MemoryAgent extends Agent<Env, MemoryAgentState> {
	override initialState: MemoryAgentState = { ready: false };

	#runtime!: AgentRuntime;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		void ctx.blockConcurrencyWhile(async () => {
			try {
				let gatewayBaseUrl: string | undefined;
				if (env.OPENAI_API_KEY) {
					try {
						gatewayBaseUrl = await env.AI.gateway(env.AI_GATEWAY_ID || "default").getUrl("openai");
					} catch {
						gatewayBaseUrl = undefined;
					}
				}
				this.#runtime = makeMemoryAgentRuntime({
					storage: ctx.storage,
					ai: env.AI,
					vectorize: env.VECTORIZE,
					docs: env.DOCS,
					...(env.OPENAI_API_KEY ? { openaiApiKey: env.OPENAI_API_KEY } : {}),
					...(gatewayBaseUrl ? { gatewayBaseUrl } : {}),
				});
				await this.#runtime.context();
				this.setState({ ready: true });
			} catch (error) {
				console.error("MemoryAgent init failed", error);
				throw error;
			}
		});
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
		const result = await this.#runtime.runPromise(ingestDocument({ userId: this.name, request }));
		this.setState({ ...this.state, lastIngest: result });
		return result;
	}

	@callable()
	async startIngest(request: IngestRequest): Promise<{ instanceId: string } | IngestResult> {
		if (this.env.INGEST_WORKFLOW) {
			const instanceId = await this.runWorkflow("INGEST_WORKFLOW", {
				userId: this.name,
				request,
			});
			return { instanceId };
		}
		return this.ingest(request);
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
		return this.#runtime.runPromise(Effect.flatMap(MemoryRepo, (repo) => repo.getDocument(id)));
	}

	@callable()
	async addMemory(input: AddMemoryRequest) {
		const userId = this.name;
		return this.#runtime.runPromise(
			Effect.flatMap(MemoryRepo, (repo) => repo.addMemory(userId, input)),
		);
	}

	@callable()
	async listSources() {
		const userId = this.name;
		return this.#runtime.runPromise(Effect.flatMap(MemoryRepo, (repo) => repo.listSources(userId)));
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
