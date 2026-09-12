import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const auth = { authorization: `Bearer ${env.YUMEOI_API_KEY}` };

const mcp = (body: unknown) =>
	SELF.fetch("https://example.com/mcp", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			...auth,
		},
		body: JSON.stringify(body),
	});

const mcpResultText = async (body: unknown) => {
	const response = await mcp(body);
	expect(response.ok).toBe(true);
	const text = await response.text();
	return text;
};

describe("P2 MCP agent experience", () => {
	it("lists recall and remember tools", async () => {
		const listed = await mcp({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
		expect(listed.ok).toBe(true);
		const text = await listed.text();
		expect(text).toContain("remember");
		expect(text).toContain("forget");
		expect(text).toContain("recall");
		expect(text).toContain("update_memory");
		expect(text).toContain("feedback");
	});

	it("remember and forget work with the env API key", async () => {
		const remembered = await mcpResultText({
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: {
				name: "remember",
				arguments: {
					text: "P2 test: Luv prefers oat milk in cloud-agent coffee.",
					mode: "verbatim",
					clientRef: "p2-oat-1",
				},
			},
		});
		expect(remembered).toMatch(/created|duplicate|merged|remember|memory/i);
		const idMatch =
			remembered.match(/m_[0-9a-hjkmnp-tv-z]{12}/i) ?? remembered.match(/[0-9a-f-]{8,}/i);
		expect(idMatch?.[0]).toBeTruthy();
		const forgotten = await mcpResultText({
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: {
				name: "forget",
				arguments: { id: idMatch?.[0], confirm: true },
			},
		});
		expect(forgotten).toContain(idMatch?.[0] ?? "missing");
	}, 30_000);

	it("remember and forget work after OAuth", async () => {
		const stub = env.MemoryAgent.getByName("p2-oauth-user");
		const created = await stub.remember({
			text: "OAuth path: ship P2 before P4.",
			mode: "verbatim",
		});
		expect(created.items.length).toBeGreaterThan(0);
		const id = created.items[0]?.id;
		expect(id).toBeTruthy();
		const forgotten = await stub.forget({ id, confirm: true });
		expect(forgotten.ids).toContain(id);
	}, 30_000);

	it("tools/list includes field descriptions for error-prone inputs", async () => {
		const listed = await mcp({ jsonrpc: "2.0", id: 10, method: "tools/list", params: {} });
		expect(listed.ok).toBe(true);
		const text = await listed.text();
		expect(text).toContain("milliseconds");
		expect(text).toContain("confirm=true");
		expect(text).toContain("text or items");
		expect(text).toMatch(/signal[\s\S]{0,400}1/);
		expect(text).toContain("ISO-8601");
	});

	it("invalid remember/feedback/forget payloads return structured hints", async () => {
		const remember = await mcpResultText({
			jsonrpc: "2.0",
			id: 11,
			method: "tools/call",
			params: { name: "remember", arguments: {} },
		});
		expect(remember).toContain("invalid_input");
		expect(remember).toContain("text or items");
		expect(remember).not.toContain("Input validation error");

		const feedback = await mcpResultText({
			jsonrpc: "2.0",
			id: 12,
			method: "tools/call",
			params: { name: "feedback", arguments: { id: "m_missing", signal: "useful" } },
		});
		expect(feedback).toContain("invalid_input");
		expect(feedback).toMatch(/signal must be the integer 1/);

		const recall = await mcpResultText({
			jsonrpc: "2.0",
			id: 13,
			method: "tools/call",
			params: { name: "recall", arguments: { query: "prefs", from: "2026-01-01" } },
		});
		expect(recall).toContain("invalid_input");
		expect(recall).toMatch(/milliseconds/);

		const missing = await mcpResultText({
			jsonrpc: "2.0",
			id: 14,
			method: "tools/call",
			params: { name: "get_memory", arguments: { id: "m_does_not_exist_xx" } },
		});
		expect(missing).toMatch(/not_found|not found/i);
	}, 30_000);
});
