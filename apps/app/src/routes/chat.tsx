import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { requireAuth, requireUserId } from "../auth/page-user.ts";
import { ChatPane } from "../components/chat-pane.tsx";
import { Page, PageHeader } from "../components/page.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";

const getChatContext = createServerFn({ method: "GET" }).handler(async () => ({
	userId: await requireUserId(),
}));

export const Route = createFileRoute("/chat")({
	validateSearch: (search: Record<string, unknown>) => ({
		mock: search.mock === "1" || search.mock === true,
	}),
	beforeLoad: () => requireAuth(),
	loader: () => getChatContext(),
	component: ChatPage,
});

function ChatPage() {
	const { userId } = Route.useLoaderData();
	const { mock: mockFromUrl } = Route.useSearch();
	const mock = mockFromUrl;
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		setMounted(true);
	}, []);

	return (
		<Page wide className="mx-auto flex min-h-svh w-[70%] max-w-[70%] flex-col">
			<PageHeader title="Chat" description="Talk to your memories." />
			{mounted ? (
				<ChatPane className="min-h-0 flex-1" mock={mock} userId={userId} />
			) : (
				<Skeleton className="min-h-0 flex-1 w-full" />
			)}
		</Page>
	);
}
