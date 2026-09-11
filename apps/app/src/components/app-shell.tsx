import {
	RiBrainLine,
	RiChat2Line,
	RiHomeLine,
	RiPlugLine,
	RiGitBranchLine,
} from "@remixicon/react";
import { Link, useRouterState } from "@tanstack/react-router";
import type { ComponentType, ReactNode } from "react";
import { pageTopPaddingClass } from "~/components/page.tsx";
import { LandingSidebarNav } from "~/components/landing-sidebar-nav.tsx";
import { landingSidebarTopPaddingClass } from "~/content/landing.ts";
import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
} from "~/components/ui/sidebar.tsx";

const appLinks = [
	{ to: "/", label: "Overview", icon: RiHomeLine },
	{ to: "/integrations", label: "Integrations", icon: RiPlugLine },
	{ to: "/memories", label: "Memories", icon: RiBrainLine },
	{ to: "/chat", label: "Chat", icon: RiChat2Line },
	{ to: "/agents", label: "Agents", icon: RiGitBranchLine },
] as const;

const isAppLinkActive = (to: string, pathname: string) =>
	to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);

const sidebarNavColumn = "ml-auto w-1/2 min-w-[22.5rem] max-w-full";

export function AppShell({ children }: { children: ReactNode }) {
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const onLanding = pathname === "/";

	return (
		<SidebarProvider>
			<a
				href="#main-content"
				className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
			>
				Skip to content
			</a>
			<Sidebar collapsible="none">
				<SidebarContent>
					<SidebarGroup
						className={
							onLanding
								? `px-2 pb-2 ${landingSidebarTopPaddingClass}`
								: `px-2 pb-2 ${pageTopPaddingClass}`
						}
					>
						<SidebarGroupContent className="flex flex-col items-end">
							{onLanding ? (
								<LandingSidebarNav className={sidebarNavColumn} />
							) : (
								<SidebarMenu className="w-max">
									{appLinks.map((link) => {
										const Icon: ComponentType = link.icon;
										return (
											<SidebarMenuItem key={link.to}>
												<SidebarMenuButton
													className="h-8 min-h-8 w-auto"
													isActive={isAppLinkActive(link.to, pathname)}
													render={<Link to={link.to} />}
													tooltip={link.label}
												>
													<Icon />
													<span>{link.label}</span>
												</SidebarMenuButton>
											</SidebarMenuItem>
										);
									})}
								</SidebarMenu>
							)}
						</SidebarGroupContent>
					</SidebarGroup>
				</SidebarContent>
			</Sidebar>
			{/* biome-ignore lint/correctness/useUniqueElementIds: skip-link fragment target is unique to the app shell */}
			<SidebarInset
				className="scroll-smooth scroll-pt-0.5 flex-none w-[calc((100%-var(--sidebar-width))*0.7)] max-w-[calc((100%-var(--sidebar-width))*0.7)]"
				id="main-content"
			>
				{children}
			</SidebarInset>
		</SidebarProvider>
	);
}
