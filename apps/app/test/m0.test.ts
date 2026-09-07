import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("MemoryAgent", () => {
	it("returns hello from RPC", async () => {
		const stub = env.MemoryAgent.getByName("demo");
		const result = await stub.hello("m0");
		expect(result.message).toBe("hello m0");
		expect(result.ready).toBe(true);
	});

	it("runs FTS5 migrations and keyword search in workerd", async () => {
		const stub = env.MemoryAgent.getByName("fts-user");
		const result = await stub.pingFts("yumeoi");
		expect(result.matches.length).toBeGreaterThan(0);
		expect(result.matches[0]?.text).toMatch(/FTS5/);
	});
});

describe("HTTP spikes", () => {
	it("serves health", async () => {
		const response = await SELF.fetch("https://example.com/api/health");
		expect(response.status).toBe(200);
		const body = (await response.json()) as { milestone: string; chatModel: { model: string } };
		expect(body.milestone).toBe("m0");
		expect(body.chatModel.model).toBe("gpt-5.6-luna");
	});

	it("serves hello through the Worker", async () => {
		const response = await SELF.fetch("https://example.com/api/spikes/hello?name=m0");
		expect(response.status).toBe(200);
		const body = (await response.json()) as { message: string };
		expect(body.message).toBe("hello m0");
	});
});

async function mcp(body: unknown) {
	return SELF.fetch("https://example.com/mcp", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
		},
		body: JSON.stringify(body),
	});
}

describe("MCP ping", () => {
	it("lists and calls ping", async () => {
		const initialize = await mcp({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "yumeoi-tests", version: "0.0.0" },
			},
		});
		expect(initialize.status).toBeLessThan(500);

		const listed = await mcp({
			jsonrpc: "2.0",
			id: 2,
			method: "tools/list",
			params: {},
		});
		expect(listed.ok).toBe(true);
		const listedBody = await listed.text();
		expect(listedBody).toContain("ping");

		const called = await mcp({
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: { name: "ping", arguments: { note: "m0" } },
		});
		expect(called.ok).toBe(true);
		expect(await called.text()).toContain("pong");
	});
});
