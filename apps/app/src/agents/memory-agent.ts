import { makeMemoryStoreRuntime, SqlClient } from "@yumeoi/cf-runtime";
import { Agent, callable } from "agents";
import { Effect } from "effect";

export type MemoryAgentState = {
	ready: boolean;
};

export class MemoryAgent extends Agent<Env, MemoryAgentState> {
	override initialState: MemoryAgentState = { ready: false };

	#runtime = makeMemoryStoreRuntime(this.ctx.storage);

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		void ctx.blockConcurrencyWhile(async () => {
			try {
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
				const sql = yield* SqlClient;
				const id = crypto.randomUUID();
				const now = Date.now();
				yield* sql`INSERT INTO memories (id, kind, text, confidence, valid_from, valid_to, supersedes, created_at)
					VALUES (${id}, ${"fact"}, ${"yumeoi stores memories in Durable Object SQLite with FTS5"}, ${1}, ${null}, ${null}, ${null}, ${now})`;
				const matches = yield* sql<{ id: string; text: string }>`
					SELECT memories.id, memories.text
					FROM memories_fts
					JOIN memories ON memories.rowid = memories_fts.rowid
					WHERE memories_fts MATCH ${query}
					LIMIT 10
				`;
				return { matches: [...matches] };
			}),
		);
	}
}
