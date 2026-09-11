import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { appUserId } from "../api/sources.ts";
import { ChatPane } from "../components/chat-pane.tsx";
import { Page, PageHeader } from "../components/page.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";

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
		<Page wide>
			<PageHeader
				title="Chat"
				description="Ask about your memories. Answers call recall and cite sources inline. Streams resume if you disconnect."
			/>
			{mounted ? <ChatPane userId={userId} /> : <Skeleton className="h-96 w-full" />}
		</Page>
	);
}
