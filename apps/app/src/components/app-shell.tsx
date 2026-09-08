import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

const links = [
	{ to: "/", label: "Home" },
	{ to: "/sources", label: "Sources" },
	{ to: "/memories", label: "Memories" },
	{ to: "/chat", label: "Chat" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
	return (
		<div className="min-h-screen">
			<header className="border-b border-[var(--line)] bg-[var(--card)]">
				<div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-6 py-4">
					<Link to="/" className="text-lg font-semibold tracking-tight">
						yumeoi
					</Link>
					<nav className="flex items-center gap-4 text-sm">
						{links.map((link) => (
							<Link
								key={link.to}
								to={link.to}
								className="text-[var(--muted)] hover:text-[var(--fg)] [&.active]:text-[var(--accent)]"
								activeProps={{ className: "text-[var(--accent)]" }}
							>
								{link.label}
							</Link>
						))}
					</nav>
				</div>
			</header>
			{children}
		</div>
	);
}
