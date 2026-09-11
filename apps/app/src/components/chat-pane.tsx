import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { ChatCitation } from "@yumeoi/domain";
import { citationsFromMessageParts } from "@yumeoi/memory";
import { useAgent } from "agents/react";
import type { UIMessage } from "ai";
import { useMemo, useState } from "react";
import { Badge } from "~/components/ui/badge.tsx";
import { Button } from "~/components/ui/button.tsx";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty.tsx";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "~/components/ui/input-group.tsx";
import { ScrollArea } from "~/components/ui/scroll-area.tsx";
import { Spinner } from "~/components/ui/spinner.tsx";
import { cn } from "~/lib/utils.ts";
import type { MemoryAgentState } from "../agents/memory-agent.ts";
import { CitedText } from "./cited-text.tsx";

export function ChatPane({ userId }: { userId: string }) {
	const agent = useAgent<MemoryAgentState>({
		agent: "MemoryAgent",
		name: userId,
	});
	const { messages, sendMessage, status, isStreaming, isRecovering, clearHistory } = useAgentChat({
		agent,
		resume: true,
	});
	const [input, setInput] = useState("");
	const [selected, setSelected] = useState<ChatCitation | null>(null);
	const busy = isStreaming || status === "submitted" || isRecovering;

	return (
		<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
			<Card className="min-h-[28rem] py-0">
				<CardHeader className="flex-row items-center justify-between border-b">
					<CardDescription>
						{agent.state?.ready ? "MemoryAgent · live" : "Connecting…"}
						{isRecovering ? " · recovering stream" : ""}
						{isStreaming ? " · streaming" : ""}
					</CardDescription>
					<Button
						size="sm"
						variant="ghost"
						onClick={() => {
							setSelected(null);
							void clearHistory();
						}}
					>
						Clear
					</Button>
				</CardHeader>
				<CardContent className="flex min-h-96 flex-1 flex-col gap-0 p-0">
					<ScrollArea className="h-96 px-4 py-4">
						<div className="flex flex-col gap-4">
							{messages.length === 0 ? (
								<Empty>
									<EmptyHeader>
										<EmptyTitle>Ask about your memories</EmptyTitle>
										<EmptyDescription>
											Answers call recall and cite sources inline.
										</EmptyDescription>
									</EmptyHeader>
								</Empty>
							) : (
								messages.map((message) => (
									<ChatBubble key={message.id} message={message} onCite={setSelected} />
								))
							)}
						</div>
					</ScrollArea>
					<form
						className="border-t p-3"
						onSubmit={(event) => {
							event.preventDefault();
							const text = input.trim();
							if (!text || busy) {
								return;
							}
							setInput("");
							void sendMessage({
								role: "user",
								parts: [{ type: "text", text }],
							});
						}}
					>
						<InputGroup>
							<InputGroupInput
								disabled={busy}
								name="message"
								placeholder="What does Luv prefer?"
								value={input}
								onChange={(event) => setInput(event.target.value)}
							/>
							<InputGroupAddon align="inline-end">
								<InputGroupButton disabled={busy || input.trim().length === 0} type="submit">
									{busy ? <Spinner data-icon="inline-start" /> : null}
									{busy ? "Thinking…" : "Send"}
								</InputGroupButton>
							</InputGroupAddon>
						</InputGroup>
					</form>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>Citation</CardTitle>
				</CardHeader>
				<CardContent>
					{selected ? (
						<div className="flex flex-col gap-2">
							<Badge variant="secondary">
								[{selected.index}] {selected.kind ?? "source"}
							</Badge>
							<p className="text-sm">{selected.text}</p>
							<p className="text-xs text-muted-foreground">{selected.title}</p>
							{selected.url ? (
								<a
									className="break-all text-xs text-primary underline-offset-4 hover:underline"
									href={selected.url}
								>
									{selected.url}
								</a>
							) : null}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">
							Click a [n] mark in an answer to open its provenance.
						</p>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

function ChatBubble({
	message,
	onCite,
}: {
	message: UIMessage;
	onCite: (citation: ChatCitation) => void;
}) {
	const citations = useMemo(() => citationsFromMessageParts(message.parts), [message.parts]);
	const text = message.parts
		.filter((part) => part.type === "text")
		.map((part) => ("text" in part ? part.text : ""))
		.join("");
	const recalling = message.parts.some(
		(part) => part.type === "tool-recall" && "state" in part && part.state !== "output-available",
	);

	return (
		<article
			className={cn(
				"max-w-xl px-3 py-2",
				message.role === "user" ? "self-end bg-muted" : "self-start border",
			)}
		>
			<p className="text-xs text-muted-foreground">{message.role}</p>
			{text ? (
				<p className="mt-2 text-sm">
					<CitedText citations={citations} text={text} onCite={onCite} />
				</p>
			) : recalling ? (
				<p className="mt-2 text-sm text-muted-foreground">Recalling memories…</p>
			) : null}
			{citations.length > 0 ? (
				<ul className="mt-3 flex flex-wrap gap-2">
					{citations.map((citation) => (
						<li key={`${citation.index}:${citation.memoryId ?? citation.documentId}`}>
							<Badge
								render={<button type="button" onClick={() => onCite(citation)} />}
								variant="outline"
							>
								[{citation.index}] {citation.title}
							</Badge>
						</li>
					))}
				</ul>
			) : null}
		</article>
	);
}
