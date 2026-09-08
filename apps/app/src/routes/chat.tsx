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
		<main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12">
			<header className="flex flex-col gap-3">
				<p className="text-sm tracking-[0.2em] text-[var(--accent)] uppercase">M3 chat</p>
				<h1 className="text-3xl font-semibold tracking-tight">Chat</h1>
				<p className="max-w-2xl text-[var(--muted)]">
					Streaming <code>AIChatAgent</code> on MemoryAgent. Tools call <code>recall</code> and{" "}
					<code>get_document</code>; citations render inline. Streams resume if you disconnect.
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
