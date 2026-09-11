import { Link, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";

const appLinks = [
	{ to: "/", label: "Overview" },
	{ to: "/integrations", label: "Integrations" },
	{ to: "/memories", label: "Memories" },
	{ to: "/chat", label: "Chat" },
	{ to: "/agents", label: "Agents" },
] as const;

const landingToc = [
	{ href: "#how-it-works", label: "How it works", sub: false },
	{ href: "#connect", label: "Connect integrations", sub: true },
	{ href: "#ingest", label: "Ingest", sub: true },
	{ href: "#memory-model", label: "Memory model", sub: true },
	{ href: "#recall", label: "Recall", sub: true },
	{ href: "#agents", label: "Agents", sub: true },
	{ href: "#decay", label: "Decay", sub: true },
	{ href: "#faq", label: "FAQ", sub: false },
] as const;

const themeFromDom = () =>
	typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "dark"
		? "dark"
		: "light";

export function AppShell({ children }: { children: ReactNode }) {
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const onLanding = pathname === "/";
	const [open, setOpen] = useState(false);
	const [theme, setTheme] = useState<"light" | "dark">("light");

	useEffect(() => {
		setTheme(themeFromDom());
	}, []);

	const toggleTheme = () => {
		const next = theme === "dark" ? "light" : "dark";
		document.documentElement.setAttribute("data-theme", next);
		localStorage.setItem("theme", next);
		setTheme(next);
	};

	return (
		<div className="layout">
			<a href="#main-content" className="skip-link">
				Skip to content
			</a>
			<aside className={open ? "sidebar open" : "sidebar"}>
				<div className="sidebar-top">
					<Link to="/" className="sidebar-logo" onClick={() => setOpen(false)}>
						yumeoi
					</Link>
					<button
						type="button"
						className="hamburger"
						aria-label="Toggle menu"
						onClick={() => setOpen((value) => !value)}
					>
						<span className="hamburger-line" />
						<span className="hamburger-line" />
					</button>
				</div>
				<nav className="sidebar-nav">
					{onLanding
						? landingToc.map((item) => (
								<a
									key={item.href}
									href={item.href}
									className={item.sub ? "toc-link toc-sub" : "toc-link"}
									onClick={() => setOpen(false)}
								>
									{item.label}
								</a>
							))
						: appLinks.map((link) => (
								<Link
									key={link.to}
									to={link.to}
									className="toc-link"
									activeProps={{ className: "toc-link active" }}
									onClick={() => setOpen(false)}
								>
									{link.label}
								</Link>
							))}
				</nav>
				<div className="sidebar-foot">
					<button
						type="button"
						className="icon-btn"
						aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
						onClick={toggleTheme}
					>
						{theme === "dark" ? (
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								aria-hidden="true"
							>
								<path d="M12 3v1.5M12 19.5V21M4.93 4.93l1.06 1.06M17.99 17.99l1.06 1.06M3 12h1.5M19.5 12H21M4.93 19.07l1.06-1.06M17.99 6.01l1.06-1.06M16.5 12a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
							</svg>
						) : (
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								aria-hidden="true"
							>
								<path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5Z" />
							</svg>
						)}
					</button>
				</div>
			</aside>
			{/* biome-ignore lint/correctness/useUniqueElementIds: skip-link fragment target is unique to the app shell */}
			<div className="content" id="main-content">
				{children}
			</div>
		</div>
	);
}
