import { decryptSecret, encryptSecret, tokenEncryptionKey } from "@yumeoi/cf-runtime";
import {
	Connector,
	type ExternalRef,
	fetchHttpLayer,
	fixtureNotionLayer,
	isFixtureToken,
	type NormalizedDocument,
	type NotionOAuthConfig,
	notionConnectorLayer,
} from "@yumeoi/connectors";
import type { IngestResult, SourceKind, SourceStatus, SourceView } from "@yumeoi/domain";
import { sha256Hex } from "@yumeoi/memory";
import { Agent, callable } from "agents";
import { Effect, Layer, Stream } from "effect";

export type SourceAgentState = {
	ready: boolean;
	userId: string;
	kind: SourceKind | "";
	label: string;
	status: SourceStatus;
	cursor: string | null;
	lastSyncedAt: number | null;
	lastError: string | null;
	documentsSeen: number;
	documentsIngested: number;
};

export type ConnectSourceInput = {
	readonly userId: string;
	readonly kind: SourceKind;
	readonly label: string;
	readonly accessToken: string;
	readonly refreshToken?: string | null;
};

export type PollResult = {
	readonly sourceId: string;
	readonly seen: number;
	readonly ingested: number;
	readonly unchanged: number;
	readonly cursor: string | null;
	readonly status: SourceStatus;
	readonly error: string | null;
};

const NOTION_POLL_SECONDS = 10 * 60;

type StoredTokens = {
	accessToken: string;
	refreshToken: string | null;
};

export class SourceAgent extends Agent<Env, SourceAgentState> {
	override initialState: SourceAgentState = {
		ready: false,
		userId: "",
		kind: "",
		label: "",
		status: "disconnected",
		cursor: null,
		lastSyncedAt: null,
		lastError: null,
		documentsSeen: 0,
		documentsIngested: 0,
	};

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		void ctx.blockConcurrencyWhile(async () => {
			this.sql`
				CREATE TABLE IF NOT EXISTS source_secrets (
					key TEXT PRIMARY KEY NOT NULL,
					value TEXT NOT NULL
				)
			`;
			this.setState({ ...this.state, ready: true });
			if (this.state.userId && this.state.status !== "disconnected") {
				await this.scheduleEvery(NOTION_POLL_SECONDS, "poll");
			}
		});
	}

	#secretKey(): string {
		return tokenEncryptionKey(this.env);
	}

	async #writeTokens(tokens: StoredTokens): Promise<void> {
		const value = await encryptSecret(this.#secretKey(), JSON.stringify(tokens));
		this.sql`DELETE FROM source_secrets WHERE key = ${"tokens"}`;
		this.sql`INSERT INTO source_secrets (key, value) VALUES (${"tokens"}, ${value})`;
	}

	async #readTokens(): Promise<StoredTokens | null> {
		const rows = this.sql<{
			value: string;
		}>`SELECT value FROM source_secrets WHERE key = ${"tokens"}`;
		const row = rows[0];
		if (!row) {
			return null;
		}
		const parsed = JSON.parse(await decryptSecret(this.#secretKey(), row.value)) as StoredTokens;
		return parsed;
	}

	#snapshot(): SourceView {
		return {
			id: this.name,
			userId: this.state.userId,
			kind: this.state.kind || "notion",
			label: this.state.label,
			status: this.state.status,
			lastSyncedAt: this.state.lastSyncedAt,
			lastError: this.state.lastError,
			documentsSeen: this.state.documentsSeen,
			documentsIngested: this.state.documentsIngested,
		};
	}

	async #publish(): Promise<void> {
		if (!this.state.userId) {
			return;
		}
		await this.env.MemoryAgent.getByName(this.state.userId).reportSourceStatus(this.#snapshot());
	}

	#oauthConfig(): NotionOAuthConfig | undefined {
		if (!this.env.NOTION_CLIENT_ID || !this.env.NOTION_CLIENT_SECRET) {
			return undefined;
		}
		return {
			clientId: this.env.NOTION_CLIENT_ID,
			clientSecret: this.env.NOTION_CLIENT_SECRET,
			redirectUri: this.env.NOTION_REDIRECT_URI || "",
		};
	}

	#connectorLayer(tokens: StoredTokens) {
		if (isFixtureToken(tokens.accessToken) || this.state.label === "Demo Notion") {
			return fixtureNotionLayer();
		}
		const oauth = this.#oauthConfig();
		return notionConnectorLayer({
			accessToken: tokens.accessToken,
			refreshToken: tokens.refreshToken,
			...(oauth ? { oauth } : {}),
		}).pipe(Layer.provide(fetchHttpLayer()));
	}

	#isAuthError(error: unknown): boolean {
		const message = error instanceof Error ? error.message : String(error);
		return (
			message.includes("Unauthorized") ||
			message.includes("http 401") ||
			message.includes("http 403")
		);
	}

	async #refreshTokens(tokens: StoredTokens): Promise<StoredTokens | null> {
		if (!tokens.refreshToken) {
			return null;
		}
		const next = await Effect.runPromise(
			Effect.gen(function* () {
				const connector = yield* Connector;
				return yield* connector.refreshAuth();
			}).pipe(Effect.provide(this.#connectorLayer(tokens))),
		);
		if (!next) {
			return null;
		}
		const stored = {
			accessToken: next.accessToken,
			refreshToken: next.refreshToken ?? tokens.refreshToken,
		};
		await this.#writeTokens(stored);
		return stored;
	}

	@callable()
	async attach(input: ConnectSourceInput): Promise<SourceView> {
		await this.#writeTokens({
			accessToken: input.accessToken,
			refreshToken: input.refreshToken ?? null,
		});
		this.setState({
			...this.state,
			ready: true,
			userId: input.userId,
			kind: input.kind,
			label: input.label,
			status: "idle",
			cursor: null,
			lastError: null,
		});
		await this.env.MemoryAgent.getByName(input.userId).registerSource({
			id: this.name,
			userId: input.userId,
			kind: input.kind,
			label: input.label,
		});
		await this.scheduleEvery(NOTION_POLL_SECONDS, "poll");
		await this.#publish();
		return this.#snapshot();
	}

	@callable()
	async disconnect(): Promise<SourceView> {
		this.sql`DELETE FROM source_secrets`;
		const schedules = await this.listSchedules();
		for (const schedule of schedules) {
			await this.cancelSchedule(schedule.id);
		}
		this.setState({
			...this.state,
			status: "disconnected",
			cursor: null,
			lastSyncedAt: null,
			lastError: null,
			documentsSeen: 0,
			documentsIngested: 0,
		});
		await this.#publish();
		return this.#snapshot();
	}

	@callable()
	status(): SourceView {
		return this.#snapshot();
	}

	@callable()
	async poll(): Promise<PollResult> {
		if (!this.state.userId || this.state.status === "disconnected") {
			return {
				sourceId: this.name,
				seen: 0,
				ingested: 0,
				unchanged: 0,
				cursor: this.state.cursor,
				status: this.state.status,
				error: this.state.lastError,
			};
		}
		this.setState({ ...this.state, status: "polling", lastError: null });
		await this.#publish();
		try {
			const tokens = await this.#readTokens();
			if (!tokens) {
				throw new Error("source has no credentials");
			}
			try {
				return await this.#syncOnce(tokens);
			} catch (error) {
				if (!this.#isAuthError(error)) {
					throw error;
				}
				const refreshed = await this.#refreshTokens(tokens);
				if (!refreshed) {
					throw error;
				}
				return await this.#syncOnce(refreshed);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.setState({ ...this.state, status: "error", lastError: message });
			await this.#publish();
			return {
				sourceId: this.name,
				seen: 0,
				ingested: 0,
				unchanged: 0,
				cursor: this.state.cursor,
				status: "error",
				error: message,
			};
		}
	}

	async #syncOnce(tokens: StoredTokens): Promise<PollResult> {
		const layer = this.#connectorLayer(tokens);
		const cursor = this.state.cursor;
		const refs = await Effect.runPromise(
			Effect.gen(function* () {
				const connector = yield* Connector;
				return yield* Stream.runCollect(connector.listChanged(cursor));
			}).pipe(Effect.provide(layer)),
		);
		const changed = [...refs];
		const previousSeen = this.state.documentsSeen;
		let ingested = 0;
		let unchanged = 0;
		const memory = this.env.MemoryAgent.getByName(this.state.userId);
		this.setState({
			...this.state,
			status: "syncing",
			documentsSeen: changed.length > 0 ? changed.length : previousSeen,
		});
		await this.#publish();
		const pending: string[] = [];
		for (const ref of changed) {
			const document = await this.#fetchNormalized(layer, ref);
			const contentHash = await sha256Hex(document.markdown);
			const previousHash = await memory.getDocumentHash(this.name, document.externalId);
			if (previousHash === contentHash) {
				unchanged += 1;
				continue;
			}
			const queued = await memory.enqueueIngest({
				externalId: document.externalId,
				title: document.title,
				markdown: document.markdown,
				sourceId: this.name,
				sourceLabel: this.state.label,
				url: document.url,
				sourceKind: this.state.kind || "notion",
			});
			if (!queued.pending) {
				this.#countIngest(queued.result, (delta) => {
					unchanged += delta.unchanged;
					ingested += delta.ingested;
				});
				continue;
			}
			if (queued.instanceId) {
				pending.push(queued.instanceId);
			}
		}
		const settled = await Promise.all(
			pending.map((instanceId) => memory.waitForIngest(instanceId)),
		);
		for (const result of settled) {
			this.#countIngest(result, (delta) => {
				unchanged += delta.unchanged;
				ingested += delta.ingested;
			});
		}
		const nextCursor =
			changed.reduce<string | null>((max, ref) => {
				const time = ref.lastEditedTime;
				if (!time) {
					return max;
				}
				return !max || time > max ? time : max;
			}, this.state.cursor) ?? this.state.cursor;
		this.setState({
			...this.state,
			status: "idle",
			cursor: nextCursor,
			lastSyncedAt: Date.now(),
			lastError: null,
			documentsSeen: changed.length > 0 ? changed.length : previousSeen,
			documentsIngested: this.state.documentsIngested + ingested,
		});
		await this.#publish();
		return {
			sourceId: this.name,
			seen: changed.length,
			ingested,
			unchanged,
			cursor: nextCursor,
			status: "idle",
			error: null,
		};
	}

	#countIngest(
		result: IngestResult | undefined,
		add: (delta: { unchanged: number; ingested: number }) => void,
	): void {
		if (!result) {
			add({ unchanged: 0, ingested: 1 });
			return;
		}
		if (result.unchanged) {
			add({ unchanged: 1, ingested: 0 });
			return;
		}
		add({ unchanged: 0, ingested: 1 });
	}

	async #fetchNormalized(
		layer: Layer.Layer<Connector>,
		ref: ExternalRef,
	): Promise<NormalizedDocument> {
		return Effect.runPromise(
			Effect.gen(function* () {
				const connector = yield* Connector;
				const raw = yield* connector.fetch(ref);
				return yield* connector.normalize(raw);
			}).pipe(Effect.provide(layer)),
		);
	}
}
