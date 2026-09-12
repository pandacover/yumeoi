import { createFileRoute, Link } from "@tanstack/react-router";
import { ClerkShow } from "../components/clerk-show.tsx";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "../components/ui/accordion.tsx";
import { Button } from "../components/ui/button.tsx";
import { Separator } from "../components/ui/separator.tsx";
import {
	continualLearningCopy,
	faqGroups,
	howItWorks,
	landingHeroTopPaddingClass,
} from "../content/landing.ts";

export const Route = createFileRoute("/")({
	component: Home,
});

function Home() {
	return (
		<div className="flex w-full max-w-3xl flex-col px-6 md:px-10">
			<section
				className={`flex min-h-[calc(100svh-3rem)] flex-col items-start gap-6 pb-16 ${landingHeroTopPaddingClass}`}
			>
				<div className="flex max-w-2xl flex-col gap-2">
					<h1 className="font-heading text-3xl font-medium tracking-tight md:text-4xl">
						horizon is a continual learning infrastructure for agents.
					</h1>
					<p className="text-base text-foreground">
						connect via MCP, external apps like Notion or API
					</p>
				</div>
				<ClerkShow when="signed-out">
					<Button
						nativeButton={false}
						render={
							// biome-ignore lint/a11y/useAnchorContent: Button children supply the label
							<a href="/sign-up" />
						}
					>
						Get started
					</Button>
				</ClerkShow>
				<ClerkShow when="signed-in">
					<Button nativeButton={false} render={<Link to="/agents" />}>
						Get started
					</Button>
				</ClerkShow>
				<Separator className="max-w-2xl" />
				<div className="flex max-w-2xl flex-col gap-4">
					{continualLearningCopy.map((paragraph) => (
						<p className="text-base text-muted-foreground" key={paragraph}>
							{paragraph}
						</p>
					))}
				</div>
			</section>

			{/* biome-ignore lint/correctness/useUniqueElementIds: landing hash target */}
			<section className="flex flex-col gap-8 scroll-mt-0.5 py-16" id="how-it-works">
				<div className="flex flex-col gap-2">
					<h2 className="font-heading text-xl font-medium">How it works</h2>
					<p className="max-w-2xl text-base text-muted-foreground">
						Horizon sits beside your agents. It ingests what you already write, turns it into a
						typed memory store, and serves the same recall path to chat, HTTP, and MCP.
					</p>
				</div>
				{howItWorks.map((item) => (
					<article className="flex flex-col gap-2 scroll-mt-0.5" id={item.id} key={item.id}>
						<h3 className="font-heading text-base font-medium">{item.title}</h3>
						<p className="max-w-2xl text-base text-muted-foreground">{item.body}</p>
					</article>
				))}
			</section>

			<Separator />

			{/* biome-ignore lint/correctness/useUniqueElementIds: landing hash target */}
			<section className="flex flex-col gap-8 scroll-mt-0.5 py-16" id="faq">
				<h2 className="font-heading text-xl font-medium">FAQ</h2>
				{faqGroups.map((group) => (
					<div className="flex flex-col gap-3" id={group.id} key={group.id}>
						<p className="text-sm text-muted-foreground">{group.title}</p>
						<Accordion multiple>
							{group.items.map((item) => (
								<AccordionItem key={item.q} value={item.q}>
									<AccordionTrigger>{item.q}</AccordionTrigger>
									<AccordionContent>{item.a}</AccordionContent>
								</AccordionItem>
							))}
						</Accordion>
					</div>
				))}
			</section>

			<footer className="flex flex-col gap-2 border-t py-12">
				<p className="text-sm font-medium">Singularity</p>
				<p className="text-xs text-muted-foreground">Horizon is a Singularity product.</p>
			</footer>
		</div>
	);
}
