import type { ChatCitation } from "@yumeoi/domain";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

export const heuristicChatResponse = (text: string, citations: ReadonlyArray<ChatCitation>) => {
	const stream = createUIMessageStream({
		execute: ({ writer }) => {
			writer.write({ type: "start" });
			writer.write({ type: "text-start", id: "reply" });
			writer.write({ type: "text-delta", id: "reply", delta: text });
			writer.write({ type: "text-end", id: "reply" });
			writer.write({
				type: "data-citations",
				id: "citations",
				data: { citations: [...citations] },
			});
			writer.write({ type: "finish", finishReason: "stop" });
		},
	});
	return createUIMessageStreamResponse({ stream });
};
