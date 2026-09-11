import { Popover } from "@base-ui/react/popover";
import type { ChatCitation } from "@yumeoi/domain";
import type * as React from "react";
import { Badge } from "~/components/ui/badge.tsx";
import { cn } from "~/lib/utils.ts";

function CitationPopoverBody({ citation }: { citation: ChatCitation }) {
	return (
		<div className="flex flex-col gap-2 p-3">
			<Badge variant="secondary">
				[{citation.index}] {citation.kind ?? "source"}
			</Badge>
			{citation.text ? <p className="text-sm">{citation.text}</p> : null}
			<p className="text-xs text-muted-foreground">{citation.title}</p>
			{citation.url ? (
				<a
					className="break-all text-xs text-primary underline-offset-4 hover:underline"
					href={citation.url}
					rel="noreferrer"
					target="_blank"
				>
					{citation.url}
				</a>
			) : null}
		</div>
	);
}

export function CitationPopover({
	citation,
	children,
	side = "top",
}: {
	citation: ChatCitation | undefined;
	children: React.ReactElement;
	side?: "top" | "bottom" | "left" | "right" | "inline-start" | "inline-end";
}) {
	if (!citation) {
		return children;
	}

	return (
		<Popover.Root>
			<Popover.Trigger delay={200} openOnHover render={children} />
			<Popover.Portal>
				<Popover.Positioner align="start" className="isolate z-50" side={side} sideOffset={6}>
					<Popover.Popup
						className={cn(
							"z-50 w-72 max-w-[min(18rem,var(--available-width))] origin-(--transform-origin) rounded-none text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 relative bg-popover/70 before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150",
						)}
					>
						<CitationPopoverBody citation={citation} />
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}
