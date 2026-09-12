import { ProviderUnavailable, RateLimited, type Unauthorized } from "@yumeoi/domain";
import { Clock, Duration, Effect, Ref, Semaphore } from "effect";
import { ConnectorHttp } from "../http.ts";
import type { NotionBlock } from "./blocks.ts";
import { NOTION_API_BASE, NOTION_VERSION } from "./oauth.ts";

export type NotionSearchResult = {
	readonly object: string;
	readonly id: string;
	readonly last_edited_time?: string;
	readonly url?: string;
	readonly properties?: Record<string, unknown>;
	readonly parent?: { readonly type?: string; readonly database_id?: string };
};

type Paginated<T> = {
	readonly results: T[];
	readonly has_more: boolean;
	readonly next_cursor: string | null;
};

export type NotionHttpError = RateLimited | ProviderUnavailable | Unauthorized;

/** Min gap between Notion request *starts*. Shared across concurrent child fetches (~3 req/s). */
export const NOTION_REQUEST_GAP_MS = 300;
/** Sibling / nested `has_children` fetches run with this bound, still gated by `NOTION_REQUEST_GAP_MS`. */
export const NOTION_CHILD_FETCH_CONCURRENCY = 4;

export type NotionFetchOptions = {
	readonly requestGapMs?: number;
	readonly childConcurrency?: number;
};

type RateGate = {
	readonly acquire: Effect.Effect<void>;
};

const makeRateGate = (gapMs: number): Effect.Effect<RateGate> =>
	Effect.gen(function* () {
		if (gapMs <= 0) {
			return { acquire: Effect.void };
		}
		const nextAt = yield* Ref.make(0);
		const lock = yield* Semaphore.make(1);
		return {
			acquire: Effect.gen(function* () {
				const waitMs = yield* lock.withPermits(1)(
					Effect.gen(function* () {
						const now = yield* Clock.currentTimeMillis;
						const scheduled = yield* Ref.get(nextAt);
						const start = Math.max(now, scheduled);
						yield* Ref.set(nextAt, start + gapMs);
						return start - now;
					}),
				);
				if (waitMs > 0) {
					yield* Effect.sleep(Duration.millis(waitMs));
				}
			}),
		};
	});

export const notionHeaders = (accessToken: string): Record<string, string> => ({
	authorization: `Bearer ${accessToken}`,
	"Notion-Version": NOTION_VERSION,
	"content-type": "application/json",
});

const parseJson = <T>(response: Response) =>
	Effect.tryPromise({
		try: () => response.json() as Promise<T>,
		catch: (cause) => new ProviderUnavailable({ provider: "notion", cause }),
	});

const asPaginated = <T>(raw: unknown): Paginated<T> => {
	if (!raw || typeof raw !== "object") {
		return { results: [], has_more: false, next_cursor: null };
	}
	const body = raw as Record<string, unknown>;
	return {
		results: Array.isArray(body.results) ? (body.results as T[]) : [],
		has_more: body.has_more === true,
		next_cursor: typeof body.next_cursor === "string" ? body.next_cursor : null,
	};
};

export const notionRequest = <T>(
	accessToken: string,
	path: string,
	init?: { readonly method?: string; readonly body?: string },
	gate?: RateGate,
): Effect.Effect<T, NotionHttpError, ConnectorHttp> =>
	Effect.gen(function* () {
		if (gate) {
			yield* gate.acquire;
		}
		const http = yield* ConnectorHttp;
		const response = yield* http
			.fetch(`${NOTION_API_BASE}${path}`, {
				...init,
				headers: notionHeaders(accessToken),
			})
			.pipe(
				Effect.catchTag("RateLimited", (error) =>
					Effect.sleep(Duration.millis(error.retryAfterMs ?? 400)).pipe(
						Effect.flatMap(() => Effect.fail(error)),
					),
				),
				Effect.retry({ times: 4, while: (error) => error instanceof RateLimited }),
			);
		if (!response.ok) {
			const text = yield* Effect.tryPromise({
				try: () => response.text(),
				catch: (cause) => new ProviderUnavailable({ provider: "notion", cause }),
			}).pipe(Effect.orElseSucceed(() => ""));
			return yield* Effect.fail(
				new ProviderUnavailable({
					provider: "notion",
					cause: `${response.status} ${text.slice(0, 200)}`,
				}),
			);
		}
		return yield* parseJson<T>(response);
	});

export const searchNotionPages = (
	accessToken: string,
	watermark: string | null,
	options?: NotionFetchOptions,
): Effect.Effect<NotionSearchResult[], NotionHttpError, ConnectorHttp> =>
	Effect.gen(function* () {
		const gate = yield* makeRateGate(options?.requestGapMs ?? NOTION_REQUEST_GAP_MS);
		const collected: NotionSearchResult[] = [];
		let cursor: string | null = null;
		let more = true;
		while (more) {
			const raw: unknown = yield* notionRequest<unknown>(
				accessToken,
				"/search",
				{
					method: "POST",
					body: JSON.stringify({
						filter: { property: "object", value: "page" },
						sort: { direction: "descending", timestamp: "last_edited_time" },
						page_size: 100,
						...(cursor ? { start_cursor: cursor } : {}),
					}),
				},
				gate,
			);
			const page: Paginated<NotionSearchResult> = asPaginated<NotionSearchResult>(raw);
			for (const item of page.results) {
				const edited = item.last_edited_time ?? "";
				if (watermark && edited && edited <= watermark) {
					return collected;
				}
				collected.push(item);
			}
			more = page.has_more;
			cursor = page.next_cursor;
		}
		return collected;
	});

const fetchBlockChildrenWithGate = (
	accessToken: string,
	blockId: string,
	gate: RateGate,
	childConcurrency: number,
): Effect.Effect<NotionBlock[], NotionHttpError, ConnectorHttp> =>
	Effect.gen(function* () {
		const collected: NotionBlock[] = [];
		const nested: Array<{ readonly index: number; readonly id: string }> = [];
		let cursor: string | null = null;
		let more = true;
		while (more) {
			const query: string = cursor
				? `?start_cursor=${encodeURIComponent(cursor)}&page_size=100`
				: "?page_size=100";
			const raw: unknown = yield* notionRequest<unknown>(
				accessToken,
				`/blocks/${encodeURIComponent(blockId)}/children${query}`,
				undefined,
				gate,
			);
			const page: Paginated<NotionBlock> = asPaginated<NotionBlock>(raw);
			for (const block of page.results) {
				const index = collected.length;
				collected.push(block);
				if (block.has_children && block.id) {
					nested.push({ index, id: block.id });
				}
			}
			more = page.has_more;
			cursor = page.next_cursor;
		}
		if (nested.length === 0) {
			return collected;
		}
		const children = yield* Effect.forEach(
			nested,
			(item) => fetchBlockChildrenWithGate(accessToken, item.id, gate, childConcurrency),
			{ concurrency: childConcurrency },
		);
		for (let i = 0; i < nested.length; i++) {
			const item = nested[i];
			const nestedChildren = children[i];
			if (!item || !nestedChildren) {
				continue;
			}
			const block = collected[item.index];
			if (block) {
				collected[item.index] = { ...block, children: nestedChildren };
			}
		}
		return collected;
	});

export const fetchBlockChildren = (
	accessToken: string,
	blockId: string,
	options?: NotionFetchOptions,
): Effect.Effect<NotionBlock[], NotionHttpError, ConnectorHttp> =>
	Effect.gen(function* () {
		const gate = yield* makeRateGate(options?.requestGapMs ?? NOTION_REQUEST_GAP_MS);
		return yield* fetchBlockChildrenWithGate(
			accessToken,
			blockId,
			gate,
			options?.childConcurrency ?? NOTION_CHILD_FETCH_CONCURRENCY,
		);
	});

export const fetchNotionPage = (
	accessToken: string,
	pageId: string,
	options?: NotionFetchOptions,
) =>
	Effect.gen(function* () {
		const gate = yield* makeRateGate(options?.requestGapMs ?? NOTION_REQUEST_GAP_MS);
		const childConcurrency = options?.childConcurrency ?? NOTION_CHILD_FETCH_CONCURRENCY;
		const page = yield* notionRequest<Record<string, unknown>>(
			accessToken,
			`/pages/${encodeURIComponent(pageId)}`,
			undefined,
			gate,
		);
		const children = yield* fetchBlockChildrenWithGate(accessToken, pageId, gate, childConcurrency);
		return { page, children };
	});

export const pageTitleFromProperties = (
	properties: Record<string, unknown> | undefined,
): string => {
	if (!properties) {
		return "Untitled";
	}
	for (const value of Object.values(properties)) {
		if (!value || typeof value !== "object") {
			continue;
		}
		const prop = value as { type?: string; title?: unknown };
		if (prop.type === "title" && Array.isArray(prop.title)) {
			const text = prop.title
				.map((item) =>
					item && typeof item === "object" && "plain_text" in item
						? String((item as { plain_text?: string }).plain_text ?? "")
						: "",
				)
				.join("")
				.trim();
			if (text) {
				return text;
			}
		}
	}
	return "Untitled";
};

export const propertiesToMarkdown = (properties: Record<string, unknown> | undefined): string => {
	if (!properties) {
		return "";
	}
	const lines: string[] = [];
	for (const [name, value] of Object.entries(properties)) {
		if (!value || typeof value !== "object") {
			continue;
		}
		const prop = value as Record<string, unknown>;
		if (prop.type === "title") {
			continue;
		}
		const rendered = renderProperty(prop);
		if (rendered) {
			lines.push(`**${name}:** ${rendered}`);
		}
	}
	return lines.join("\n");
};

const renderProperty = (prop: Record<string, unknown>): string => {
	switch (prop.type) {
		case "rich_text":
			return Array.isArray(prop.rich_text)
				? prop.rich_text
						.map((item) =>
							item && typeof item === "object" && "plain_text" in item
								? String((item as { plain_text?: string }).plain_text ?? "")
								: "",
						)
						.join("")
				: "";
		case "select":
			return prop.select && typeof prop.select === "object"
				? String((prop.select as { name?: string }).name ?? "")
				: "";
		case "multi_select":
			return Array.isArray(prop.multi_select)
				? prop.multi_select
						.map((item) =>
							item && typeof item === "object" && "name" in item
								? String((item as { name?: string }).name ?? "")
								: "",
						)
						.filter(Boolean)
						.join(", ")
				: "";
		case "status":
			return prop.status && typeof prop.status === "object"
				? String((prop.status as { name?: string }).name ?? "")
				: "";
		case "checkbox":
			return prop.checkbox === true ? "yes" : "no";
		case "number":
			return prop.number == null ? "" : String(prop.number);
		case "url":
			return typeof prop.url === "string" ? prop.url : "";
		case "email":
			return typeof prop.email === "string" ? prop.email : "";
		case "date":
			return prop.date && typeof prop.date === "object"
				? String((prop.date as { start?: string }).start ?? "")
				: "";
		case "people":
			return Array.isArray(prop.people)
				? prop.people
						.map((person) =>
							person && typeof person === "object" && "name" in person
								? String((person as { name?: string }).name ?? "")
								: "",
						)
						.filter(Boolean)
						.join(", ")
				: "";
		default:
			return "";
	}
};

export const isNotionPagePayload = (
	raw: unknown,
): raw is { page: Record<string, unknown>; children: NotionBlock[] } =>
	Boolean(raw && typeof raw === "object" && "page" in raw && "children" in raw);
