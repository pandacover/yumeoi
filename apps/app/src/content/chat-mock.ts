import type { UIMessage } from "ai";

const longUser =
	"Can you walk me through everything you know about Effect 4, how I like to structure the domain layer, and the deployment checklist I keep repeating? ".repeat(
		8,
	);

const longAssistant =
	"Here is a longer answer that should stay fully visible instead of collapsing behind Show more. Effect 4 is the domain layer preference, ingest runs through the Worker, and citations stay inline. ".repeat(
		10,
	);

/** Sample thread for `/chat?mock=1` UI development. */
export const mockChatMessages: UIMessage[] = [
	{
		id: "mock-user-1",
		role: "user",
		parts: [{ type: "text", text: longUser.trim() }],
	},
	{
		id: "mock-assistant-1",
		role: "assistant",
		parts: [{ type: "text", text: longAssistant.trim() }],
	},
];
