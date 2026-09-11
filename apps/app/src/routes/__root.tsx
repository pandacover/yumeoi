import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppShell } from "../components/app-shell.tsx";
import { Toaster } from "../components/ui/sonner.tsx";
import { TooltipProvider } from "../components/ui/tooltip.tsx";
import appCss from "../styles/app.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "yumeoi" },
			{
				name: "description",
				content: "Yumeoi is a continual learning infrastructure for agents.",
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
				<TooltipProvider>
					<AppShell>{children}</AppShell>
					<Toaster />
				</TooltipProvider>
				<Scripts />
			</body>
		</html>
	);
}
