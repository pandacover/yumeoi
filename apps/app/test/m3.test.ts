import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("M3 chat", () => {
	it("serves health for m3 with resumable chat tools", async () => {
		const response = await SELF.fetch("https://example.com/api/health");
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			milestone: string;
			chat: { resumable: boolean; tools: string[]; model: { model: string; effort: string } };
		};
		expect(["m3", "m4"]).toContain(body.milestone);
		expect(body.chat.resumable).toBe(true);
		expect(body.chat.tools).toEqual(["recall", "get_document"]);
		expect(body.chat.model).toEqual({ model: "gpt-5.6-luna", effort: "high" });
	});

	it("answers from recalled memories with numbered citations", async () => {
		const stub = env.MemoryAgent.getByName("chat-answer-user");
		const ingest = await stub.ingest({
			externalId: "chat-doc",
			title: "Preferences",
			markdown: "Luv prefers Effect 4 for the yumeoi domain layer.",
			sourceId: "generic",
			sourceLabel: "Notes",
			url: "https://example.com/prefs",
		});
		expect(ingest.memoryCount).toBeGreaterThan(0);

		const reply = await stub.answerQuestion("What does Luv prefer?");
		expect(reply.text.toLowerCase()).toContain("effect");
		expect(reply.citations.length).toBeGreaterThan(0);
		expect(reply.text).toContain("[1]");
		expect(reply.citations[0]?.title).toBeTruthy();
	});

	it("runs a heuristic AIChatAgent turn that persists an assistant message", async () => {
		const stub = env.MemoryAgent.getByName("chat-turn-user");
		await stub.ingest({
			externalId: "chat-turn-doc",
			title: "Preferences",
			markdown: "Luv prefers Effect 4 for the yumeoi domain layer.",
			sourceId: "generic",
			sourceLabel: "Notes",
			url: null,
		});

		const turn = await stub.startChatTurn("What does Luv prefer?");
		expect(turn.status).toBe("completed");

		const messages = await stub.listChatMessages();
		expect(messages.some((message) => message.role === "user")).toBe(true);
		const assistant = [...messages].reverse().find((message) => message.role === "assistant");
		expect(assistant).toBeTruthy();
		expect(JSON.stringify(assistant).toLowerCase()).toContain("effect");
	});
});
