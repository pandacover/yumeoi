import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { type FetchFn, fetchHttpLayer } from "../http.ts";
import {
	fetchBlockChildren,
	fetchNotionPage,
	NOTION_CHILD_FETCH_CONCURRENCY,
	NOTION_REQUEST_GAP_MS,
} from "./client.ts";

const json = (body: unknown) => Response.json(body);

const childrenPayload = (results: unknown[], next?: string | null) =>
	json({
		results,
		has_more: Boolean(next),
		next_cursor: next ?? null,
	});

const blockUrlId = (url: string): string | null => {
	const match = url.match(/\/blocks\/([^/]+)\/children/);
	return match?.[1] ? decodeURIComponent(match[1]) : null;
};

const pageWithNestedSiblings = (input: string): Response => {
	const url = String(input);
	if (url.includes("/pages/page-root")) {
		return json({ id: "page-root", url: "https://www.notion.so/page-root", properties: {} });
	}
	const blockId = blockUrlId(url);
	if (blockId === "page-root") {
		return childrenPayload([
			{
				id: "block-a",
				type: "bulleted_list_item",
				has_children: true,
				bulleted_list_item: { rich_text: [{ text: { content: "A" } }] },
			},
			{
				id: "block-b",
				type: "bulleted_list_item",
				has_children: true,
				bulleted_list_item: { rich_text: [{ text: { content: "B" } }] },
			},
			{
				id: "block-c",
				type: "bulleted_list_item",
				has_children: true,
				bulleted_list_item: { rich_text: [{ text: { content: "C" } }] },
			},
			{
				id: "block-d",
				type: "paragraph",
				has_children: false,
				paragraph: { rich_text: [{ text: { content: "leaf" } }] },
			},
		]);
	}
	if (blockId === "block-a" || blockId === "block-b" || blockId === "block-c") {
		return childrenPayload([
			{
				id: `${blockId}-child`,
				type: "paragraph",
				has_children: false,
				paragraph: { rich_text: [{ text: { content: blockId } }] },
			},
		]);
	}
	return new Response("not found", { status: 404 });
};

describe("Notion fetch limits", () => {
	test("exposes a rate-limit-friendly gap and bounded child concurrency", () => {
		expect(NOTION_REQUEST_GAP_MS).toBe(300);
		expect(NOTION_CHILD_FETCH_CONCURRENCY).toBeGreaterThanOrEqual(3);
		expect(NOTION_CHILD_FETCH_CONCURRENCY).toBeLessThanOrEqual(5);
	});

	test("fetches sibling nested blocks concurrently when the gap is zero", async () => {
		const starts: Record<string, number> = {};
		const origin = Date.now();
		const fetchImpl: FetchFn = async (input) => {
			const id = blockUrlId(String(input));
			if (id === "block-a" || id === "block-b" || id === "block-c") {
				starts[id] = Date.now() - origin;
				await Bun.sleep(80);
			}
			return pageWithNestedSiblings(String(input));
		};
		const result = await Effect.runPromise(
			fetchNotionPage("secret", "page-root", { requestGapMs: 0, childConcurrency: 4 }).pipe(
				Effect.provide(fetchHttpLayer(fetchImpl)),
			),
		);
		expect(result.children).toHaveLength(4);
		expect(result.children[0]?.children).toHaveLength(1);
		expect(result.children[1]?.children).toHaveLength(1);
		expect(result.children[2]?.children).toHaveLength(1);
		const times = ["block-a", "block-b", "block-c"].map((id) => starts[id] ?? Number.NaN);
		expect(times.every((time) => Number.isFinite(time))).toBe(true);
		expect(Math.max(...times) - Math.min(...times)).toBeLessThan(50);
	});

	test("spaces sibling fetches by the shared request gap", async () => {
		const starts: number[] = [];
		const fetchImpl: FetchFn = async (input) => {
			const id = blockUrlId(String(input));
			if (id === "block-a" || id === "block-b" || id === "block-c") {
				starts.push(Date.now());
			}
			return pageWithNestedSiblings(String(input));
		};
		await Effect.runPromise(
			fetchBlockChildren("secret", "page-root", { requestGapMs: 50, childConcurrency: 4 }).pipe(
				Effect.provide(fetchHttpLayer(fetchImpl)),
			),
		);
		expect(starts).toHaveLength(3);
		const ordered = [...starts].sort((left, right) => left - right);
		for (let i = 1; i < ordered.length; i++) {
			expect((ordered[i] ?? 0) - (ordered[i - 1] ?? 0)).toBeGreaterThanOrEqual(40);
		}
	});
});
