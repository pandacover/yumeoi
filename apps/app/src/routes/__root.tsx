import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { AppShell } from "../components/app-shell.tsx";
import { Toaster } from "../components/ui/sonner.tsx";
import { TooltipProvider } from "../components/ui/tooltip.tsx";
import appCss from "../styles/app.css?url";

const themeBootstrap = {
	__html: `(function(){try{var p=localStorage.getItem('theme');var d=p==='dark'||((p==null||p==='system')&&matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}})()`,
};

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

function ThemeBootstrap() {
	// biome-ignore lint/security/noDangerouslySetInnerHtml: static theme bootstrap, no user input
	return <script dangerouslySetInnerHTML={themeBootstrap} />;
}

function RootDocument({ children }: { children: ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<ThemeBootstrap />
				<HeadContent />
			</head>
			<body>
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					disableTransitionOnChange
					enableSystem
				>
					<TooltipProvider>
						<AppShell>{children}</AppShell>
						<Toaster />
					</TooltipProvider>
				</ThemeProvider>
				<Scripts />
			</body>
		</html>
	);
}
