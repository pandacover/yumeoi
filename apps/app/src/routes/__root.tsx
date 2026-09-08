import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppShell } from "../components/app-shell.tsx";
import appCss from "../styles/app.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "yumeoi — m3" },
			{
				name: "description",
				content: "Connect sources, extract memories, and chat with them from the UI, MCP, and HTTP.",
			},
		],
		links: [{ rel: "stylesheet", href: appCss }],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				<AppShell>{children}</AppShell>
				<Scripts />
			</body>
		</html>
	);
}
