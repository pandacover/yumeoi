import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { ChatCitation } from "@yumeoi/domain";
import { citationsFromMessageParts } from "@yumeoi/memory";
import { useAgent } from "agents/react";
import type { UIMessage } from "ai";
import { useMemo, useState } from "react";
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
			<section className="flex min-h-[28rem] flex-col rounded-2xl border border-[var(--line)] bg-[var(--card)]">
				<div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3">
					<p className="text-sm text-[var(--muted)]">
						{agent.state?.ready ? "MemoryAgent · live" : "Connecting…"}
						{isRecovering ? " · recovering stream" : ""}
						{isStreaming ? " · streaming" : ""}
					</p>
					<button
						type="button"
						className="text-xs text-[var(--muted)] hover:text-[var(--fg)]"
						onClick={() => {
							setSelected(null);
							void clearHistory();
						}}
					>
						Clear
					</button>
				</div>
				<div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
					{messages.length === 0 ? (
						<p className="text-[var(--muted)]">
							Ask about your memories. Answers call <code>recall</code> and cite sources inline.
						</p>
					) : (
						messages.map((message) => (
							<ChatBubble key={message.id} message={message} onCite={setSelected} />
						))
					)}
				</div>
				<form
					className="flex gap-3 border-t border-[var(--line)] p-4"
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
					<input
						className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2"
						value={input}
						onChange={(event) => setInput(event.target.value)}
						placeholder="What does Luv prefer?"
						name="message"
						disabled={busy}
					/>
					<button
						className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--bg)] disabled:opacity-50"
						disabled={busy || input.trim().length === 0}
						type="submit"
					>
						{busy ? "Thinking…" : "Send"}
					</button>
				</form>
			</section>
			<aside className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
				<h2 className="text-lg font-medium">Citation</h2>
				{selected ? (
					<div className="mt-3 flex flex-col gap-2 text-sm">
						<p className="text-xs uppercase tracking-wide text-[var(--accent)]">
							[{selected.index}] {selected.kind ?? "source"}
						</p>
						<p>{selected.text}</p>
						<p className="text-[var(--muted)]">{selected.title}</p>
						{selected.url ? (
							<a className="text-[var(--accent)]" href={selected.url}>
								{selected.url}
							</a>
						) : null}
					</div>
				) : (
					<p className="mt-3 text-sm text-[var(--muted)]">
						Click a [n] mark in an answer to open its provenance.
					</p>
				)}
			</aside>
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
			className={`max-w-[42rem] rounded-2xl px-4 py-3 ${
				message.role === "user"
					? "self-end bg-[var(--bg)]"
					: "self-start border border-[var(--line)]"
			}`}
		>
			<p className="text-xs uppercase tracking-wide text-[var(--muted)]">{message.role}</p>
			{text ? (
				<p className="mt-2">
					<CitedText text={text} citations={citations} onCite={onCite} />
				</p>
			) : recalling ? (
				<p className="mt-2 text-sm text-[var(--muted)]">Recalling memories…</p>
			) : null}
			{citations.length > 0 ? (
				<ul className="mt-3 flex flex-wrap gap-2">
					{citations.map((citation) => (
						<li key={`${citation.index}:${citation.memoryId ?? citation.documentId}`}>
							<button
								type="button"
								className="rounded-full border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--muted)] hover:text-[var(--accent)]"
								onClick={() => onCite(citation)}
							>
								[{citation.index}] {citation.title}
							</button>
						</li>
					))}
				</ul>
			) : null}
		</article>
	);
}
