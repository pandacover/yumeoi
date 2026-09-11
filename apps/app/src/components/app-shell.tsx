import { UserButton } from "@clerk/tanstack-react-start";
import {
	RiBrainLine,
	RiChat2Line,
	RiGitBranchLine,
	RiHomeLine,
	RiPlugLine,
} from "@remixicon/react";
import { Link, useRouterState } from "@tanstack/react-router";
import type { ComponentType, ReactNode } from "react";
import { ClerkShow } from "~/components/clerk-show.tsx";
import { LandingSidebarNav } from "~/components/landing-sidebar-nav.tsx";
import { pageTopPaddingClass } from "~/components/page.tsx";
import { Button } from "~/components/ui/button.tsx";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
} from "~/components/ui/sidebar.tsx";
import { landingSidebarTopPaddingClass } from "~/content/landing.ts";

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
	const onAuthPage = pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up");

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
							) : onAuthPage ? (
								<SidebarMenu className="w-max">
									<SidebarMenuItem>
										<SidebarMenuButton
											className="h-8 min-h-8 w-auto"
											render={<Link to="/" />}
											tooltip="Overview"
										>
											<RiHomeLine />
											<span>Overview</span>
										</SidebarMenuButton>
									</SidebarMenuItem>
								</SidebarMenu>
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
				<SidebarFooter className="items-end px-2 pb-4">
					<ClerkShow when="signed-out">
						{onAuthPage ? null : (
							<Button
								className="h-8"
								nativeButton={false}
								render={
									// biome-ignore lint/a11y/useAnchorContent: Button children supply the label
									<a href="/sign-in" />
								}
								size="sm"
								variant="ghost"
							>
								Sign in
							</Button>
						)}
					</ClerkShow>
					<ClerkShow when="signed-in">
						<UserButton />
					</ClerkShow>
				</SidebarFooter>
			</Sidebar>
			{/* biome-ignore lint/correctness/useUniqueElementIds: skip-link fragment target is unique to the app shell */}
			<SidebarInset className="scroll-smooth scroll-pt-0.5" id="main-content">
				{children}
			</SidebarInset>
		</SidebarProvider>
	);
}
