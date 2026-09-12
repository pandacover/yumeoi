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
		<Page
			wide
			className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-1 flex-col md:w-[70%] md:max-w-[70%]"
		>
			<PageHeader title="Chat" description="Talk to your memories." />
			{mounted ? (
				<ChatPane className="min-h-0 flex-1" mock={mock} userId={userId} />
			) : (
				<Skeleton className="min-h-0 flex-1 w-full" />
			)}
		</Page>
	);
}
