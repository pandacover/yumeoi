import {
	RiBrainLine,
	RiChat2Line,
	RiGitBranchLine,
	RiHomeLine,
	RiMenuLine,
	RiPlugLine,
	RiUserLine,
} from "@remixicon/react";
import { Link, useRouterState } from "@tanstack/react-router";
import { type ComponentType, type ReactNode, useState } from "react";
import { ClerkShow } from "~/components/clerk-show.tsx";
import { LandingSidebarNav } from "~/components/landing-sidebar-nav.tsx";
import { pageTopPaddingClass } from "~/components/page.tsx";
import { Button } from "~/components/ui/button.tsx";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "~/components/ui/sheet.tsx";
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

	if (onAuthPage) {
		return <main className="min-h-svh w-full">{children}</main>;
	}

	return (
		<SidebarProvider className="flex-col md:flex-row">
			<a
				href="#main-content"
				className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
			>
				Skip to content
			</a>
			<MobileNav onLanding={onLanding} pathname={pathname} />
			<Sidebar className="hidden md:flex" collapsible="none">
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
								<AppSidebarMenu pathname={pathname} />
							)}
						</SidebarGroupContent>
					</SidebarGroup>
				</SidebarContent>
				<SidebarFooter className="items-end px-2 pb-4">
					<ClerkShow when="signed-out">
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
					</ClerkShow>
				</SidebarFooter>
			</Sidebar>
			{/* biome-ignore lint/correctness/useUniqueElementIds: skip-link fragment target is unique to the app shell */}
			<SidebarInset className="min-h-0 min-w-0 scroll-smooth scroll-pt-0.5" id="main-content">
				{children}
			</SidebarInset>
		</SidebarProvider>
	);
}

function AppSidebarMenu({ pathname }: { pathname: string }) {
	return (
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
			<ClerkShow when="signed-in">
				<SidebarMenuItem>
					<SidebarMenuButton
						className="h-8 min-h-8 w-auto"
						isActive={pathname.startsWith("/profile")}
						render={
							// biome-ignore lint/a11y/useAnchorContent: SidebarMenuButton children supply the label
							<a href="/profile" />
						}
						tooltip="Profile"
					>
						<RiUserLine />
						<span>Profile</span>
					</SidebarMenuButton>
				</SidebarMenuItem>
			</ClerkShow>
		</SidebarMenu>
	);
}

function MobileNav({ onLanding, pathname }: { onLanding: boolean; pathname: string }) {
	const [open, setOpen] = useState(false);

	return (
		<header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3 md:hidden">
			<Sheet onOpenChange={setOpen} open={open}>
				<SheetTrigger render={<Button size="icon-sm" type="button" variant="ghost" />}>
					<RiMenuLine />
					<span className="sr-only">Open menu</span>
				</SheetTrigger>
				<SheetContent className="max-h-[min(100svh,36rem)] overflow-y-auto md:hidden" side="top">
					<SheetHeader>
						<SheetTitle>horizon</SheetTitle>
						<SheetDescription className="sr-only">Site navigation</SheetDescription>
					</SheetHeader>
					<nav className="flex flex-col gap-1 px-4 pb-4">
						{onLanding ? (
							<LandingMobileLinks onNavigate={() => setOpen(false)} />
						) : (
							<AppMobileLinks onNavigate={() => setOpen(false)} pathname={pathname} />
						)}
					</nav>
				</SheetContent>
			</Sheet>
			<span className="font-heading text-sm font-medium">horizon</span>
		</header>
	);
}

function AppMobileLinks({ pathname, onNavigate }: { pathname: string; onNavigate: () => void }) {
	return (
		<>
			{appLinks.map((link) => {
				const Icon: ComponentType = link.icon;
				const active = isAppLinkActive(link.to, pathname);
				return (
					<Button
						key={link.to}
						className="h-9 w-full justify-start"
						nativeButton={false}
						render={<Link onClick={onNavigate} to={link.to} />}
						variant={active ? "secondary" : "ghost"}
					>
						<Icon data-icon="inline-start" />
						{link.label}
					</Button>
				);
			})}
			<ClerkShow when="signed-in">
				<Button
					className="h-9 w-full justify-start"
					nativeButton={false}
					render={
						// biome-ignore lint/a11y/useAnchorContent: Button children supply the label
						<a href="/profile" onClick={onNavigate} />
					}
					variant={pathname.startsWith("/profile") ? "secondary" : "ghost"}
				>
					<RiUserLine data-icon="inline-start" />
					Profile
				</Button>
			</ClerkShow>
			<ClerkShow when="signed-out">
				<Button
					className="h-9 w-full justify-start"
					nativeButton={false}
					render={
						// biome-ignore lint/a11y/useAnchorContent: Button children supply the label
						<a href="/sign-in" onClick={onNavigate} />
					}
					variant="ghost"
				>
					Sign in
				</Button>
			</ClerkShow>
		</>
	);
}

function LandingMobileLinks({ onNavigate }: { onNavigate: () => void }) {
	const goTo = (id: string) => {
		onNavigate();
		window.setTimeout(() => {
			document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
		}, 150);
	};

	return (
		<>
			<Button
				className="h-9 w-full justify-start"
				variant="ghost"
				onClick={() => goTo("how-it-works")}
			>
				How it works
			</Button>
			<Button className="h-9 w-full justify-start" variant="ghost" onClick={() => goTo("faq")}>
				FAQ
			</Button>
			<ClerkShow when="signed-out">
				<Button
					className="h-9 w-full justify-start"
					nativeButton={false}
					render={
						// biome-ignore lint/a11y/useAnchorContent: Button children supply the label
						<a href="/sign-in" onClick={onNavigate} />
					}
					variant="ghost"
				>
					Sign in
				</Button>
			</ClerkShow>
			<ClerkShow when="signed-in">
				<Button
					className="h-9 w-full justify-start"
					nativeButton={false}
					render={<Link onClick={onNavigate} to="/agents" />}
					variant="ghost"
				>
					Get started
				</Button>
			</ClerkShow>
		</>
	);
}
