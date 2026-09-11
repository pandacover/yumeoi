"use client";

import { useEffect, useState } from "react";

type SectionMetric = {
	id: string;
	top: number;
	bottom: number;
};

function getSectionMetrics(container: HTMLElement, sectionIds: readonly string[]): SectionMetric[] {
	const containerRect = container.getBoundingClientRect();
	const scrollTop = container.scrollTop;
	const metrics: SectionMetric[] = [];

	for (const id of sectionIds) {
		const el = document.getElementById(id);
		if (!el) continue;
		const rect = el.getBoundingClientRect();
		const top = rect.top - containerRect.top + scrollTop;
		metrics.push({ id, top, bottom: top + el.offsetHeight });
	}

	return metrics;
}

function getActiveSectionId(metrics: SectionMetric[], scrollY: number): string | null {
	if (metrics.length === 0) return null;

	let active: string | null = null;

	for (let i = 0; i < metrics.length; i++) {
		const current = metrics[i];
		if (!current) continue;
		const previous = i > 0 ? metrics[i - 1] : undefined;
		const switchPoint =
			i === 0 || !previous ? current.top / 2 : (previous.bottom + current.top) / 2;
		if (scrollY >= switchPoint) active = current.id;
	}

	return active;
}

export function useScrollSpy(
	sectionIds: readonly string[],
	{ containerId = "main-content" }: { containerId?: string } = {},
) {
	const [activeId, setActiveId] = useState<string | null>(null);

	useEffect(() => {
		const container = document.getElementById(containerId);
		if (!container) return;

		const update = () => {
			const metrics = getSectionMetrics(container, sectionIds);
			const scrollPaddingTop = Number.parseFloat(getComputedStyle(container).scrollPaddingTop) || 0;
			const scrollY = container.scrollTop + scrollPaddingTop;
			setActiveId(getActiveSectionId(metrics, scrollY));
		};

		update();
		container.addEventListener("scroll", update, { passive: true });
		window.addEventListener("resize", update, { passive: true });

		return () => {
			container.removeEventListener("scroll", update);
			window.removeEventListener("resize", update);
		};
	}, [containerId, sectionIds]);

	return activeId;
}
