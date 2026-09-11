import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppShell } from "../components/app-shell.tsx";
import appCss from "../styles/app.css?url";

const themeBootstrap = {
	__html: `(function(){var p=localStorage.getItem('theme')||'system';var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light')})()`,
};

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "yumeoi" },
			{
				name: "description",
				content:
					"Connect sources, extract memories, chat with them, and share them with agents over MCP OAuth.",
			},
		],
		links: [
			{ rel: "stylesheet", href: "https://rsms.me/inter/inter.css" },
			{ rel: "stylesheet", href: appCss },
		],
	}),
	shellComponent: RootDocument,
});

function ThemeBootstrap() {
	// biome-ignore lint/security/noDangerouslySetInnerHtml: static theme bootstrap, no user input
	return <script dangerouslySetInnerHTML={themeBootstrap} />;
}

function RootDocument({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<head>
				<ThemeBootstrap />
				<HeadContent />
			</head>
			<body>
				<AppShell>{children}</AppShell>
				<Scripts />
			</body>
		</html>
	);
}
