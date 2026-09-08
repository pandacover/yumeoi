import { describe, expect, test } from "bun:test";
import { Effect, Stream } from "effect";
import { type FetchFn, fetchHttpLayer } from "../http.ts";
import { Connector } from "../types.ts";
import { blocksToMarkdown } from "./blocks.ts";
import { notionConnectorLayer } from "./connector.ts";
import { fixtureNotionLayer } from "./fixture.ts";

describe("fixture Notion connector", () => {
	test("lists pages newer than the cursor", async () => {
		const program = Effect.gen(function* () {
			const connector = yield* Connector;
			const all = yield* Stream.runCollect(connector.listChanged(null));
			const newer = yield* Stream.runCollect(connector.listChanged("2026-09-01T12:00:00.000Z"));
			return { all, newer };
		});
		const result = await Effect.runPromise(program.pipe(Effect.provide(fixtureNotionLayer())));
		expect(result.all.length).toBe(3);
		expect(result.newer.length).toBe(2);
	});

	test("fetches and normalizes a fixture page", async () => {
		const program = Effect.gen(function* () {
			const connector = yield* Connector;
			const raw = yield* connector.fetch({
				externalId: "page-prefs",
				contentHash: "2026-09-01T12:00:00.000Z",
			});
			return yield* connector.normalize(raw);
		});
		const document = await Effect.runPromise(program.pipe(Effect.provide(fixtureNotionLayer())));
		expect(document.title).toBe("Preferences");
		expect(document.markdown).toContain("Effect 4");
		expect(document.url).toContain("notion.so");
	});
});

describe("live Notion connector with fake HTTP", () => {
	test("stops search at the last_edited_time watermark", async () => {
		const fetchImpl: FetchFn = async (input, init) => {
			const url = String(input);
			if (url.endsWith("/search") && init?.method === "POST") {
				return Response.json({
					results: [
						{
							object: "page",
							id: "new-page",
							last_edited_time: "2026-09-08T10:00:00.000Z",
							url: "https://www.notion.so/new",
							properties: {
								title: { type: "title", title: [{ plain_text: "New" }] },
							},
						},
						{
							object: "page",
							id: "old-page",
							last_edited_time: "2026-09-01T00:00:00.000Z",
							url: "https://www.notion.so/old",
						},
					],
					has_more: false,
					next_cursor: null,
				});
			}
			return new Response("not found", { status: 404 });
		};
		const program = Effect.gen(function* () {
			const connector = yield* Connector;
			return yield* Stream.runCollect(connector.listChanged("2026-09-02T00:00:00.000Z"));
		});
		const refs = await Effect.runPromise(
			program.pipe(
				Effect.provide(notionConnectorLayer({ accessToken: "secret" })),
				Effect.provide(fetchHttpLayer(fetchImpl)),
			),
		);
		expect([...refs].map((ref) => ref.externalId)).toEqual(["new-page"]);
	});

	test("normalizes fetched blocks into markdown", async () => {
		const markdown = blocksToMarkdown([
			{
				type: "heading_2",
				heading_2: { rich_text: [{ text: { content: "Prefs" } }] },
			},
			{
				type: "paragraph",
				paragraph: { rich_text: [{ text: { content: "Luv prefers Effect 4." } }] },
			},
		]);
		expect(markdown).toBe("## Prefs\n\nLuv prefers Effect 4.");
	});
});
