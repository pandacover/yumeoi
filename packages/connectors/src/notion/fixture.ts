import { Effect, Layer, Stream } from "effect";
import { Connector, type ExternalRef, type NormalizedDocument } from "../types.ts";
import type { NotionBlock } from "./blocks.ts";

export type FixturePage = {
	readonly id: string;
	readonly lastEditedTime: string;
	readonly title: string;
	readonly url: string;
	readonly markdown: string;
	readonly properties?: Record<string, unknown>;
	readonly children?: ReadonlyArray<NotionBlock>;
};

export const FIXTURE_PAGES: ReadonlyArray<FixturePage> = [
	{
		id: "page-prefs",
		lastEditedTime: "2026-09-01T12:00:00.000Z",
		title: "Preferences",
		url: "https://www.notion.so/prefs",
		markdown: "Luv prefers Effect 4 for the yumeoi domain layer.",
	},
	{
		id: "page-decision",
		lastEditedTime: "2026-09-02T12:00:00.000Z",
		title: "Decisions",
		url: "https://www.notion.so/decision",
		markdown: "Luv decided to run ingest on Cloudflare Workflows.",
	},
	{
		id: "row-task",
		lastEditedTime: "2026-09-03T12:00:00.000Z",
		title: "Ship M2",
		url: "https://www.notion.so/task",
		markdown: "**Status:** In progress\n\nLuv needs to ship M2 this week.",
	},
];

const toRef = (page: FixturePage): ExternalRef => ({
	externalId: page.id,
	contentHash: page.lastEditedTime,
	lastEditedTime: page.lastEditedTime,
});

const toNormalized = (page: FixturePage): NormalizedDocument => ({
	externalId: page.id,
	title: page.title,
	markdown: page.markdown,
	url: page.url,
	contentHash: page.lastEditedTime,
});

export const fixtureNotionLayer = (pages: ReadonlyArray<FixturePage> = FIXTURE_PAGES) =>
	Layer.succeed(Connector, {
		kind: "notion",
		listChanged: (cursor) =>
			Stream.fromIterable(
				pages.filter((page) => !cursor || page.lastEditedTime > cursor).map(toRef),
			),
		fetch: (ref) => {
			const page = pages.find((item) => item.id === ref.externalId);
			return page
				? Effect.succeed({
						page: {
							id: page.id,
							url: page.url,
							last_edited_time: page.lastEditedTime,
							properties: {
								title: {
									type: "title",
									title: [{ type: "text", plain_text: page.title, text: { content: page.title } }],
								},
								...(page.properties ?? {}),
							},
						},
						children:
							page.children ??
							([
								{
									type: "paragraph",
									paragraph: {
										rich_text: [
											{ type: "text", plain_text: page.markdown, text: { content: page.markdown } },
										],
									},
								},
							] satisfies NotionBlock[]),
					})
				: Effect.succeed({ page: { id: ref.externalId }, children: [] });
		},
		normalize: (raw) => {
			if (raw && typeof raw === "object" && "page" in raw) {
				const page = (raw as { page: { id?: string } }).page;
				const found = pages.find((item) => item.id === page.id);
				if (found) {
					return Effect.succeed(toNormalized(found));
				}
			}
			return Effect.succeed({
				externalId: "unknown",
				title: "Untitled",
				markdown: "",
				url: null,
				contentHash: "unknown",
			});
		},
		refreshAuth: () => Effect.succeed(null),
	});

export const isFixtureToken = (token: string | null | undefined): boolean =>
	token === "fixture" || token === "ym_fixture" || Boolean(token?.startsWith("fixture:"));
