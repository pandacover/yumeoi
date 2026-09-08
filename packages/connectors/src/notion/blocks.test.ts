import { describe, expect, test } from "bun:test";
import { blocksToMarkdown, type NotionBlock, richTextToMarkdown } from "./blocks.ts";

describe("richTextToMarkdown", () => {
	test("applies bold, italic, strike, code, and links", () => {
		expect(
			richTextToMarkdown([
				{ type: "text", text: { content: "bold" }, annotations: { bold: true } },
				{ type: "text", text: { content: " " } },
				{ type: "text", text: { content: "em" }, annotations: { italic: true } },
				{ type: "text", text: { content: " " } },
				{ type: "text", text: { content: "gone" }, annotations: { strikethrough: true } },
				{ type: "text", text: { content: " " } },
				{ type: "text", text: { content: "fn" }, annotations: { code: true } },
				{
					type: "text",
					text: { content: "docs", link: { url: "https://example.com" } },
					href: "https://example.com",
				},
			]),
		).toBe("**bold** *em* ~~gone~~ `fn`[docs](https://example.com)");
	});

	test("renders mentions and inline equations", () => {
		expect(
			richTextToMarkdown([
				{
					type: "mention",
					plain_text: "@Luv",
					mention: { type: "user", user: { name: "Luv" } },
				},
				{ type: "equation", equation: { expression: "e=mc^2" } },
			]),
		).toBe("@Luv$e=mc^2$");
	});
});

describe("blocksToMarkdown", () => {
	test("converts headings, lists, todos, quotes, and code", () => {
		const blocks: NotionBlock[] = [
			{ type: "heading_1", heading_1: { rich_text: [{ text: { content: "Title" } }] } },
			{ type: "paragraph", paragraph: { rich_text: [{ text: { content: "Hello" } }] } },
			{
				type: "bulleted_list_item",
				bulleted_list_item: { rich_text: [{ text: { content: "one" } }] },
			},
			{
				type: "numbered_list_item",
				numbered_list_item: { rich_text: [{ text: { content: "two" } }] },
			},
			{
				type: "to_do",
				to_do: { checked: true, rich_text: [{ text: { content: "ship" } }] },
			},
			{ type: "quote", quote: { rich_text: [{ text: { content: "remember" } }] } },
			{
				type: "code",
				code: { language: "ts", rich_text: [{ text: { content: "const x = 1" } }] },
			},
			{ type: "divider", divider: {} },
		];
		const markdown = blocksToMarkdown(blocks);
		expect(markdown).toContain("# Title");
		expect(markdown).toContain("Hello");
		expect(markdown).toContain("- one");
		expect(markdown).toContain("1. two");
		expect(markdown).toContain("- [x] ship");
		expect(markdown).toContain("> remember");
		expect(markdown).toContain("```ts\nconst x = 1\n```");
		expect(markdown).toContain("---");
	});

	test("renders callouts, images, and tables", () => {
		const markdown = blocksToMarkdown([
			{
				type: "callout",
				callout: {
					icon: { emoji: "💡" },
					rich_text: [{ text: { content: "note" } }],
				},
			},
			{
				type: "image",
				image: {
					type: "external",
					external: { url: "https://img.example/a.png" },
					caption: [{ text: { content: "diagram" } }],
				},
			},
			{
				type: "table",
				table: {},
				children: [
					{
						type: "table_row",
						table_row: { cells: [[{ text: { content: "Col" } }], [{ text: { content: "Val" } }]] },
					},
					{
						type: "table_row",
						table_row: { cells: [[{ text: { content: "A" } }], [{ text: { content: "1" } }]] },
					},
				],
			},
		]);
		expect(markdown).toContain("> 💡 note");
		expect(markdown).toContain("![diagram](https://img.example/a.png)");
		expect(markdown).toContain("| Col | Val |");
		expect(markdown).toContain("| A | 1 |");
	});

	test("nests list children", () => {
		const markdown = blocksToMarkdown([
			{
				type: "bulleted_list_item",
				bulleted_list_item: { rich_text: [{ text: { content: "parent" } }] },
				children: [
					{
						type: "bulleted_list_item",
						bulleted_list_item: { rich_text: [{ text: { content: "child" } }] },
					},
				],
			},
		]);
		expect(markdown).toContain("- parent");
		expect(markdown).toContain("  - child");
	});
});
