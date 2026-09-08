export type NotionAnnotation = {
	readonly bold?: boolean;
	readonly italic?: boolean;
	readonly strikethrough?: boolean;
	readonly underline?: boolean;
	readonly code?: boolean;
};

export type NotionRichText = {
	readonly type?: string;
	readonly plain_text?: string;
	readonly href?: string | null;
	readonly annotations?: NotionAnnotation;
	readonly text?: { readonly content?: string; readonly link?: { readonly url?: string } | null };
	readonly mention?: { readonly type?: string; readonly [key: string]: unknown };
	readonly equation?: { readonly expression?: string };
};

export type NotionBlock = {
	readonly id?: string;
	readonly type?: string;
	readonly has_children?: boolean;
	readonly children?: ReadonlyArray<NotionBlock>;
	readonly [key: string]: unknown;
};

const wrap = (text: string, left: string, right = left): string =>
	text.length === 0 ? text : `${left}${text}${right}`;

export const richTextToMarkdown = (rich: ReadonlyArray<NotionRichText> | undefined): string => {
	if (!rich || rich.length === 0) {
		return "";
	}
	return rich
		.map((span) => {
			if (span.type === "equation" && span.equation?.expression) {
				return `$${span.equation.expression}$`;
			}
			const raw =
				span.text?.content ??
				span.plain_text ??
				(span.type === "mention" ? mentionLabel(span) : "");
			if (!raw) {
				return "";
			}
			let text = raw;
			const annotations = span.annotations;
			if (annotations?.code) {
				text = wrap(text, "`");
			}
			if (annotations?.bold && annotations.italic) {
				text = wrap(text, "***");
			} else if (annotations?.bold) {
				text = wrap(text, "**");
			} else if (annotations?.italic) {
				text = wrap(text, "*");
			}
			if (annotations?.strikethrough) {
				text = wrap(text, "~~");
			}
			const href = span.href ?? span.text?.link?.url;
			if (href) {
				text = `[${text}](${href})`;
			}
			return text;
		})
		.join("");
};

const mentionLabel = (span: NotionRichText): string => {
	const mention = span.mention;
	if (!mention) {
		return span.plain_text ?? "";
	}
	if (mention.type === "user" && mention.user && typeof mention.user === "object") {
		const name = (mention.user as { name?: string }).name;
		return name ? `@${name}` : (span.plain_text ?? "@user");
	}
	if (mention.type === "page" && mention.page && typeof mention.page === "object") {
		return span.plain_text ?? "page";
	}
	return span.plain_text ?? "";
};

const payload = (block: NotionBlock): Record<string, unknown> => {
	const type = typeof block.type === "string" ? block.type : "";
	const value = type ? block[type] : undefined;
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
};

const richOf = (block: NotionBlock, key = "rich_text"): string => {
	const value = payload(block)[key];
	return Array.isArray(value) ? richTextToMarkdown(value as NotionRichText[]) : "";
};

const childrenOf = (block: NotionBlock): ReadonlyArray<NotionBlock> =>
	Array.isArray(block.children) ? block.children : [];

const indent = (text: string, depth: number): string =>
	text
		.split("\n")
		.map((line) => (line.length === 0 ? line : `${"  ".repeat(depth)}${line}`))
		.join("\n");

const fileUrl = (value: unknown): string | null => {
	if (!value || typeof value !== "object") {
		return null;
	}
	const record = value as Record<string, unknown>;
	if (record.type === "external" && record.external && typeof record.external === "object") {
		const url = (record.external as { url?: string }).url;
		return typeof url === "string" ? url : null;
	}
	if (record.type === "file" && record.file && typeof record.file === "object") {
		const url = (record.file as { url?: string }).url;
		return typeof url === "string" ? url : null;
	}
	if (typeof record.url === "string") {
		return record.url;
	}
	return null;
};

const renderTable = (block: NotionBlock): string => {
	const rows = childrenOf(block).filter((child) => child.type === "table_row");
	if (rows.length === 0) {
		return "";
	}
	const cells = rows.map((row) => {
		const raw = payload(row).cells;
		if (!Array.isArray(raw)) {
			return [];
		}
		return raw.map((cell) =>
			Array.isArray(cell) ? richTextToMarkdown(cell as NotionRichText[]) : String(cell ?? ""),
		);
	});
	const width = Math.max(...cells.map((row) => row.length), 1);
	const padded = cells.map((row) => [
		...row,
		...Array.from({ length: width - row.length }, () => ""),
	]);
	const header = padded[0] ?? Array.from({ length: width }, () => "");
	const sep = header.map(() => "---");
	const body = padded.slice(1);
	return [
		`| ${header.join(" | ")} |`,
		`| ${sep.join(" | ")} |`,
		...body.map((row) => `| ${row.join(" | ")} |`),
	].join("\n");
};

export const blockToMarkdown = (block: NotionBlock, depth = 0): string => {
	const type = typeof block.type === "string" ? block.type : "";
	const body = payload(block);
	const text = richOf(block);
	const kids = childrenOf(block);
	const nested = kids
		.filter((child) => child.type !== "table_row")
		.map((child) =>
			blockToMarkdown(child, type.endsWith("list_item") || type === "to_do" ? depth + 1 : depth),
		)
		.filter((line) => line.length > 0)
		.join("\n");

	let line = "";
	switch (type) {
		case "heading_1":
			line = `# ${text}`;
			break;
		case "heading_2":
			line = `## ${text}`;
			break;
		case "heading_3":
			line = `### ${text}`;
			break;
		case "paragraph":
			line = text;
			break;
		case "bulleted_list_item":
			line = `- ${text}`;
			break;
		case "numbered_list_item":
			line = `1. ${text}`;
			break;
		case "to_do":
			line = `- [${body.checked === true ? "x" : " "}] ${text}`;
			break;
		case "toggle":
			line = `<details>\n<summary>${text}</summary>\n\n${nested}\n</details>`;
			return indent(line, depth);
		case "quote":
			line = text
				.split("\n")
				.map((part) => `> ${part}`)
				.join("\n");
			break;
		case "callout": {
			const emoji =
				body.icon && typeof body.icon === "object" && "emoji" in body.icon
					? String((body.icon as { emoji?: string }).emoji ?? "")
					: "";
			line = `> ${emoji ? `${emoji} ` : ""}${text}`;
			break;
		}
		case "code": {
			const language = typeof body.language === "string" ? body.language : "";
			line = `\`\`\`${language}\n${text}\n\`\`\``;
			break;
		}
		case "divider":
			line = "---";
			break;
		case "equation":
			line = typeof body.expression === "string" ? `$$\n${body.expression}\n$$` : text;
			break;
		case "image": {
			const url = fileUrl(body);
			const caption = Array.isArray(body.caption)
				? richTextToMarkdown(body.caption as NotionRichText[])
				: "image";
			line = url ? `![${caption || "image"}](${url})` : caption;
			break;
		}
		case "bookmark":
		case "embed":
		case "link_preview": {
			const url = typeof body.url === "string" ? body.url : fileUrl(body);
			const caption = Array.isArray(body.caption)
				? richTextToMarkdown(body.caption as NotionRichText[])
				: url;
			line = url ? `[${caption || url}](${url})` : "";
			break;
		}
		case "file":
		case "pdf":
		case "video":
		case "audio": {
			const url = fileUrl(body);
			line = url ? `[${type}](${url})` : "";
			break;
		}
		case "table":
			line = renderTable(block);
			break;
		case "child_page":
			line = `## ${typeof body.title === "string" ? body.title : "Untitled page"}`;
			break;
		case "child_database":
			line = `## ${typeof body.title === "string" ? body.title : "Database"}`;
			break;
		case "link_to_page":
			line = text || "*linked page*";
			break;
		case "synced_block":
		case "column_list":
		case "column":
			line = "";
			break;
		case "table_of_contents":
		case "breadcrumb":
		case "unsupported":
			return "";
		default:
			line = text;
	}

	const parts = [indent(line, depth), nested].filter((part) => part.length > 0);
	return parts.join("\n");
};

export const blocksToMarkdown = (blocks: ReadonlyArray<NotionBlock>): string =>
	blocks
		.map((block) => blockToMarkdown(block))
		.filter((part) => part.length > 0)
		.join("\n\n")
		.trim();

export const titleFromRichText = (rich: ReadonlyArray<NotionRichText> | undefined): string =>
	richTextToMarkdown(rich).trim() || "Untitled";
