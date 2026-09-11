import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { appUserId } from "../api/sources.ts";
import { ChatPane } from "../components/chat-pane.tsx";

const getChatContext = createServerFn({ method: "GET" }).handler(async () => ({
	userId: appUserId(env),
}));

export const Route = createFileRoute("/chat")({
	loader: () => getChatContext(),
	component: ChatPage,
});

function ChatPage() {
	const { userId } = Route.useLoaderData();
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		setMounted(true);
	}, []);

	return (
		<main className="page page-wide">
			<header className="mb-8">
				<h1 className="hero-heading">Chat</h1>
				<p className="hero-sub">
					Ask about your memories. Answers call recall and cite sources inline. Streams resume if
					you disconnect.
				</p>
			</header>
			{mounted ? (
				<ChatPane userId={userId} />
			) : (
				<p className="text-sm text-[var(--muted)]">Connecting to MemoryAgent…</p>
			)}
		</main>
	);
}
