import { SchemaViolation } from "@yumeoi/domain";
import { Effect, Layer, Stream } from "effect";
import { ConnectorHttp } from "../http.ts";
import {
	Connector,
	type ConnectorAuth,
	type ExternalRef,
	type NormalizedDocument,
} from "../types.ts";
import { blocksToMarkdown, type NotionBlock } from "./blocks.ts";
import {
	fetchNotionPage,
	isNotionPagePayload,
	pageTitleFromProperties,
	propertiesToMarkdown,
	searchNotionPages,
} from "./client.ts";
import { type NotionOAuthConfig, refreshNotionToken } from "./oauth.ts";

export type NotionConnectorOptions = {
	readonly accessToken: string;
	readonly refreshToken?: string | null;
	readonly oauth?: NotionOAuthConfig;
};

const toRef = (item: { id: string; last_edited_time?: string }): ExternalRef => ({
	externalId: item.id,
	contentHash: item.last_edited_time ?? item.id,
	...(item.last_edited_time ? { lastEditedTime: item.last_edited_time } : {}),
});

export const normalizeNotionPage = (
	raw: unknown,
): Effect.Effect<NormalizedDocument, SchemaViolation> =>
	Effect.gen(function* () {
		if (!isNotionPagePayload(raw)) {
			return yield* Effect.fail(new SchemaViolation({ message: "expected Notion page payload" }));
		}
		const page = raw.page;
		const properties =
			page.properties && typeof page.properties === "object"
				? (page.properties as Record<string, unknown>)
				: undefined;
		const title = pageTitleFromProperties(properties);
		const propertyMarkdown = propertiesToMarkdown(properties);
		const body = blocksToMarkdown(raw.children as NotionBlock[]);
		const markdown = [propertyMarkdown, body].filter((part) => part.length > 0).join("\n\n");
		const url = typeof page.url === "string" ? page.url : null;
		const contentHash = yield* Effect.promise(async () => {
			const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(markdown));
			return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
		});
		return {
			externalId: typeof page.id === "string" ? page.id : "unknown",
			title,
			markdown: markdown || title,
			url,
			contentHash,
		};
	});

export const notionConnectorLayer = (
	options: NotionConnectorOptions,
): Layer.Layer<Connector, never, ConnectorHttp> =>
	Layer.effect(
		Connector,
		Effect.gen(function* () {
			const http = yield* ConnectorHttp;
			const run = <A, E>(effect: Effect.Effect<A, E, ConnectorHttp>) =>
				effect.pipe(Effect.provideService(ConnectorHttp, http));
			return {
				kind: "notion" as const,
				listChanged: (cursor: string | null) =>
					Stream.fromIterableEffect(
						run(searchNotionPages(options.accessToken, cursor)).pipe(
							Effect.map((pages) => pages.map(toRef)),
						),
					),
				fetch: (ref: ExternalRef) => run(fetchNotionPage(options.accessToken, ref.externalId)),
				normalize: normalizeNotionPage,
				refreshAuth: () =>
					options.refreshToken && options.oauth
						? run(refreshNotionToken(options.oauth, options.refreshToken)).pipe(
								Effect.map(
									(token): ConnectorAuth => ({
										accessToken: token.accessToken,
										refreshToken: token.refreshToken,
									}),
								),
							)
						: Effect.succeed(null),
			};
		}),
	);
