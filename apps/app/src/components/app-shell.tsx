import {
	RiBrainLine,
	RiChatSmileLine,
	RiHomeLine,
	RiPlugLine,
	RiQuestionLine,
	RiRobotLine,
} from "@remixicon/react";
import { Link, useRouterState } from "@tanstack/react-router";
import type { ComponentType, ReactNode } from "react";
import { ThemeToggle } from "~/components/theme-toggle.tsx";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarHeader,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
	SidebarProvider,
	SidebarRail,
	SidebarTrigger,
} from "~/components/ui/sidebar.tsx";

const appLinks = [
	{ to: "/", label: "Overview", icon: RiHomeLine },
	{ to: "/integrations", label: "Integrations", icon: RiPlugLine },
	{ to: "/memories", label: "Memories", icon: RiBrainLine },
	{ to: "/chat", label: "Chat", icon: RiChatSmileLine },
	{ to: "/agents", label: "Agents", icon: RiRobotLine },
] as const;

const landingHow = [
	{ href: "#connect", label: "Connect integrations" },
	{ href: "#ingest", label: "Ingest" },
	{ href: "#memory-model", label: "Memory model" },
	{ href: "#recall", label: "Recall" },
	{ href: "#agents", label: "Agents" },
	{ href: "#decay", label: "Decay" },
] as const;

const isAppLinkActive = (to: string, pathname: string) =>
	to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);

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
			<Sidebar>
				<SidebarHeader>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton render={<Link to="/" />} size="lg" tooltip="yumeoi">
								<span className="font-heading text-sm font-medium">yumeoi</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarHeader>
				<SidebarContent>
					<SidebarGroup>
						<SidebarGroupContent>
							<SidebarMenu>
								{onLanding ? (
									<>
										<SidebarMenuItem>
											{/* biome-ignore lint/a11y/useAnchorContent: link text is the SidebarMenuButton children */}
											<SidebarMenuButton render={<a href="#how-it-works" />} tooltip="How it works">
												<RiHomeLine />
												<span>How it works</span>
											</SidebarMenuButton>
											<SidebarMenuSub>
												{landingHow.map((item) => (
													<SidebarMenuSubItem key={item.href}>
														<SidebarMenuSubButton href={item.href}>
															{item.label}
														</SidebarMenuSubButton>
													</SidebarMenuSubItem>
												))}
											</SidebarMenuSub>
										</SidebarMenuItem>
										<SidebarMenuItem>
											{/* biome-ignore lint/a11y/useAnchorContent: link text is the SidebarMenuButton children */}
											<SidebarMenuButton render={<a href="#faq" />} tooltip="FAQ">
												<RiQuestionLine />
												<span>FAQ</span>
											</SidebarMenuButton>
										</SidebarMenuItem>
									</>
								) : (
									appLinks.map((link) => {
										const Icon: ComponentType = link.icon;
										return (
											<SidebarMenuItem key={link.to}>
												<SidebarMenuButton
													isActive={isAppLinkActive(link.to, pathname)}
													render={<Link to={link.to} />}
													tooltip={link.label}
												>
													<Icon />
													<span>{link.label}</span>
												</SidebarMenuButton>
											</SidebarMenuItem>
										);
									})
								)}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				</SidebarContent>
				<SidebarFooter>
					<ThemeToggle />
				</SidebarFooter>
				<SidebarRail />
			</Sidebar>
			{/* biome-ignore lint/correctness/useUniqueElementIds: skip-link fragment target is unique to the app shell */}
			<SidebarInset id="main-content">
				<header className="flex h-12 items-center gap-2 px-3">
					<SidebarTrigger />
				</header>
				{children}
			</SidebarInset>
		</SidebarProvider>
	);
}
