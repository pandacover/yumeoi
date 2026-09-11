"use client";

import { RiHomeLine, RiQuestionLine } from "@remixicon/react";
import { cn } from "cn";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
} from "~/components/ui/sidebar.tsx";
import { howItWorks } from "~/content/landing.ts";
import { useScrollSpy } from "~/hooks/use-scroll-spy.ts";

const scrollSpySections = ["how-it-works", ...howItWorks.map((item) => item.id), "faq"] as const;

const subsectionIds = new Set<string>(howItWorks.map((item) => item.id));

type IndicatorState = {
	top: number;
	height: number;
	left: number;
	width: number;
	visible: boolean;
};

export function LandingSidebarNav({ className }: { className?: string }) {
	const activeId = useScrollSpy(scrollSpySections);
	const subWrapRef = useRef<HTMLDivElement>(null);
	const [indicator, setIndicator] = useState<IndicatorState>({
		top: 0,
		height: 0,
		left: 0,
		width: 1,
		visible: false,
	});

	const howItWorksActive =
		activeId === "how-it-works" || (activeId != null && subsectionIds.has(activeId));
	const faqActive = activeId === "faq";

	const indicatorTargetId =
		activeId != null && subsectionIds.has(activeId)
			? activeId
			: activeId === "how-it-works"
				? howItWorks[0]?.id
				: null;

	const measureIndicator = useCallback(() => {
		const wrap = subWrapRef.current;
		if (!wrap || !indicatorTargetId) {
			setIndicator((prev) => ({ ...prev, visible: false }));
			return;
		}

		const index = howItWorks.findIndex((item) => item.id === indicatorTargetId);
		if (index < 0) {
			setIndicator((prev) => ({ ...prev, visible: false }));
			return;
		}

		const items = wrap.querySelectorAll("[data-slot=sidebar-menu-sub-item]");
		const item = items[index] as HTMLElement | undefined;
		const list = wrap.querySelector("[data-slot=sidebar-menu-sub]") as HTMLElement | null;
		if (!item || !list) {
			setIndicator((prev) => ({ ...prev, visible: false }));
			return;
		}

		const wrapRect = wrap.getBoundingClientRect();
		const itemRect = item.getBoundingClientRect();
		const listRect = list.getBoundingClientRect();
		const borderWidth = Number.parseFloat(getComputedStyle(list).borderLeftWidth) || 1;

		setIndicator({
			top: itemRect.top - wrapRect.top,
			height: itemRect.height,
			left: listRect.left - wrapRect.left,
			width: borderWidth,
			visible: true,
		});
	}, [indicatorTargetId]);

	useLayoutEffect(() => {
		measureIndicator();
	}, [measureIndicator]);

	useLayoutEffect(() => {
		const wrap = subWrapRef.current;
		if (!wrap) return;

		const observer = new ResizeObserver(measureIndicator);
		observer.observe(wrap);
		return () => observer.disconnect();
	}, [measureIndicator]);

	return (
		<SidebarMenu className={className}>
			<SidebarMenuItem>
				<SidebarMenuButton
					isActive={howItWorksActive}
					render={
						// biome-ignore lint/a11y/useAnchorContent: SidebarMenuButton children supply the visible label
						<a href="#how-it-works" />
					}
					tooltip="How it works"
				>
					<RiHomeLine />
					<span>How it works</span>
				</SidebarMenuButton>
				<div className="relative w-full" ref={subWrapRef}>
					<SidebarMenuSub>
						{howItWorks.map((item) => (
							<SidebarMenuSubItem key={item.id}>
								<SidebarMenuSubButton href={`#${item.id}`} isActive={indicatorTargetId === item.id}>
									{item.title}
								</SidebarMenuSubButton>
							</SidebarMenuSubItem>
						))}
					</SidebarMenuSub>
					<div
						aria-hidden
						className={cn(
							"pointer-events-none absolute bg-foreground transition-[top,height,left,width,opacity] duration-300 ease-out",
							!indicator.visible && "opacity-0",
						)}
						style={{
							top: indicator.top,
							height: indicator.height,
							left: indicator.left,
							width: indicator.width,
						}}
					/>
				</div>
			</SidebarMenuItem>
			<SidebarMenuItem>
				<SidebarMenuButton
					isActive={faqActive}
					render={
						// biome-ignore lint/a11y/useAnchorContent: SidebarMenuButton children supply the visible label
						<a href="#faq" />
					}
					tooltip="FAQ"
				>
					<RiQuestionLine />
					<span>FAQ</span>
				</SidebarMenuButton>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
