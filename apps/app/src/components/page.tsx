import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "~/components/ui/breadcrumb.tsx";
import { cn } from "~/lib/utils.ts";

/** Keep in sync with app shell sidebar top padding. */
export const pageTopPaddingClass = "pt-8";

export function Page({
	children,
	wide,
	className,
}: {
	children: ReactNode;
	wide?: boolean;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex w-full flex-col gap-8 px-6 md:px-10",
				pageTopPaddingClass,
				"pb-8",
				wide ? "max-w-5xl" : "max-w-3xl",
				className,
			)}
		>
			{children}
		</div>
	);
}

export function PageHeader({ title, description }: { title: string; description?: string }) {
	return (
		<header className="flex flex-col gap-2">
			<h1 className="font-heading text-2xl font-medium tracking-tight">{title}</h1>
			{description ? (
				<p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
			) : null}
		</header>
	);
}

export function PageCrumb({
	to,
	label,
	current,
}: {
	to: "/integrations" | "/agents";
	label: string;
	current: string;
}) {
	return (
		<Breadcrumb>
			<BreadcrumbList>
				<BreadcrumbItem>
					<BreadcrumbLink render={<Link to={to} />}>{label}</BreadcrumbLink>
				</BreadcrumbItem>
				<BreadcrumbSeparator />
				<BreadcrumbItem>
					<BreadcrumbPage>{current}</BreadcrumbPage>
				</BreadcrumbItem>
			</BreadcrumbList>
		</Breadcrumb>
	);
}
