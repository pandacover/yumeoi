import { RiArrowUpLine } from "@remixicon/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { citationsFromMessageParts } from "@yumeoi/memory";
import { useAgent } from "agents/react";
import type { UIMessage } from "ai";
import {
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { Badge } from "~/components/ui/badge.tsx";
import { Button } from "~/components/ui/button.tsx";
import { Card, CardContent } from "~/components/ui/card.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty.tsx";
import {
	InputGroup,
	InputGroupButton,
	InputGroupTextarea,
} from "~/components/ui/input-group.tsx";
import { ScrollArea } from "~/components/ui/scroll-area.tsx";
import { Spinner } from "~/components/ui/spinner.tsx";
import { cn } from "~/lib/utils.ts";
import { mockChatMessages } from "../content/chat-mock.ts";
import type { MemoryAgentState } from "../agents/memory-agent.ts";
import { CitationPopover } from "./citation-popover.tsx";
import { CitedText } from "./cited-text.tsx";

export function ChatPane({
	userId,
	mock = false,
	className,
}: {
	userId: string;
	mock?: boolean;
	className?: string;
}) {
	const agent = useAgent<MemoryAgentState>({
		agent: "MemoryAgent",
		name: userId,
	});
	const live = useAgentChat({
		agent,
		resume: !mock,
	});
	const messages = mock ? mockChatMessages : live.messages;
	const sendMessage = live.sendMessage;
	const { status, isStreaming, isRecovering } = live;
	const [input, setInput] = useState("");
	const [composerHeight, setComposerHeight] = useState(58);
	const composerRef = useRef<HTMLFormElement>(null);
	const busy = mock ? false : isStreaming || status === "submitted" || isRecovering;

	const syncComposerHeight = useCallback(() => {
		const form = composerRef.current;
		if (!form) {
			return;
		}
		setComposerHeight(form.getBoundingClientRect().height);
	}, []);

	useLayoutEffect(() => {
		const form = composerRef.current;
		if (!form) {
			return;
		}
		syncComposerHeight();
		const observer = new ResizeObserver(() => syncComposerHeight());
		observer.observe(form);
		for (const element of form.querySelectorAll("textarea, [data-slot=input-group]")) {
			observer.observe(element);
		}
		return () => observer.disconnect();
	}, [syncComposerHeight]);

	useLayoutEffect(() => {
		syncComposerHeight();
	}, [input, syncComposerHeight]);

	const submitMessage = () => {
		const text = input.trim();
		if (!text || busy) {
			return;
		}
		setInput("");
		if (mock) {
			return;
		}
		void sendMessage({
			role: "user",
			parts: [{ type: "text", text }],
		});
	};

	return (
		<div className={cn("flex h-full min-h-0 flex-col", className)}>
			<Card className="flex h-full min-h-0 flex-col py-0 text-sm/relaxed">
				<CardContent className="relative flex min-h-0 flex-1 flex-col overflow-hidden p-0">
					<div
						className="absolute inset-x-0 top-0 min-h-0 px-4 pt-4"
						style={{ bottom: `${composerHeight}px` }}
					>
						<ScrollArea className="h-full">
							<div className="flex flex-col gap-4 pb-4">
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
								messages.map((message) => <ChatBubble key={message.id} message={message} />)
							)}
							</div>
						</ScrollArea>
					</div>
					<form
						ref={composerRef}
						className="absolute inset-x-0 bottom-0 z-10 pt-3 pb-3 pl-4 pr-[calc(1rem+0.625rem)]"
						onSubmit={(event) => {
							event.preventDefault();
							submitMessage();
						}}
					>
						<InputGroup className="h-auto w-full">
							<InputGroupTextarea
								className="min-h-8! max-h-[calc(1.25rem*6+0.5rem)] overflow-y-auto py-1! pr-10 text-sm md:text-sm"
								disabled={busy}
								name="message"
								placeholder="What does Luv prefer?"
								rows={1}
								value={input}
								onChange={(event) => setInput(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter" && !event.shiftKey) {
										event.preventDefault();
										submitMessage();
									}
								}}
							/>
							<InputGroupButton
								aria-label={busy ? "Sending message" : "Send message"}
								className="absolute right-1 bottom-0.5"
								disabled={busy || input.trim().length === 0}
								size="icon-sm"
								type="submit"
							>
								{busy ? <Spinner /> : <RiArrowUpLine />}
							</InputGroupButton>
						</InputGroup>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}

function ChatBubble({ message }: { message: UIMessage }) {
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
			className={cn("w-full px-3 py-2", message.role === "user" ? "bg-muted" : undefined)}
		>
			{text ? (
				<CollapsibleBubbleBody bodyKey={message.id}>
					<CitedText citations={citations} text={text} />
				</CollapsibleBubbleBody>
			) : recalling ? (
				<p className="text-sm text-muted-foreground">Recalling memories…</p>
			) : null}
			{citations.length > 0 ? (
				<ul className="mt-3 flex flex-wrap gap-2">
					{citations.map((citation) => (
						<li key={`${citation.index}:${citation.memoryId ?? citation.documentId}`}>
							<CitationPopover citation={citation} side="bottom">
								<Badge render={<button type="button" />} variant="outline">
									[{citation.index}] {citation.title}
								</Badge>
							</CitationPopover>
						</li>
					))}
				</ul>
			) : null}
		</article>
	);
}

const bubbleBodyMaxHeightClass = "max-h-[calc(1.25rem*6)]";

function CollapsibleBubbleBody({
	bodyKey,
	children,
}: {
	bodyKey: string;
	children: ReactNode;
}) {
	const bodyRef = useRef<HTMLDivElement>(null);
	const [expanded, setExpanded] = useState(false);
	const [expandable, setExpandable] = useState(false);

	const measureExpandable = useCallback(() => {
		const el = bodyRef.current;
		if (!el || expanded) {
			return;
		}
		setExpandable(el.scrollHeight > el.clientHeight + 1);
	}, [expanded]);

	useLayoutEffect(() => {
		measureExpandable();
		const el = bodyRef.current;
		if (!el) {
			return;
		}
		const observer = new ResizeObserver(() => measureExpandable());
		observer.observe(el);
		return () => observer.disconnect();
	}, [bodyKey, measureExpandable]);

	return (
		<div className="flex flex-col items-start gap-1">
			<div
				ref={bodyRef}
				className={cn(
					"text-sm leading-5",
					!expanded && cn(bubbleBodyMaxHeightClass, "overflow-hidden"),
				)}
			>
				{children}
			</div>
			{expandable ? (
				<Button
					className="h-auto px-0 py-0 text-sm"
					size="xs"
					type="button"
					variant="link"
					onClick={() => setExpanded((value) => !value)}
				>
					{expanded ? "Show less" : "Show more"}
				</Button>
			) : null}
		</div>
	);
}
