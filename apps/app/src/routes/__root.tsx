import { ClerkProvider } from "@clerk/tanstack-react-start";
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
			{ title: "horizon" },
			{
				name: "description",
				content: "Horizon is a continual learning infrastructure for agents.",
			},
		],
		links: [
			{ rel: "stylesheet", href: appCss },
			{ rel: "icon", href: "/favicon.ico?v=2", sizes: "any" },
			{ rel: "icon", href: "/favicon.png?v=2", type: "image/png", sizes: "192x192" },
			{ rel: "apple-touch-icon", href: "/apple-touch-icon.png?v=2", sizes: "180x180" },
		],
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
				<ClerkProvider>
					<TooltipProvider>
						<AppShell>{children}</AppShell>
						<Toaster />
					</TooltipProvider>
				</ClerkProvider>
				<Scripts />
			</body>
		</html>
	);
}
