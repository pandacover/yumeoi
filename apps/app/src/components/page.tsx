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

export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
	return (
		<div
			className={cn(
				"mx-auto flex w-full flex-col gap-8 px-6 py-8 md:px-10",
				wide ? "max-w-5xl" : "max-w-3xl",
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
