import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
	component: Home,
});

function Home() {
	return (
		<main className="flex min-h-screen items-center justify-center px-6">
			<p className="max-w-3xl text-center text-4xl sm:text-5xl">
				<strong className="font-semibold text-[var(--brand)]">yumeoi</strong>, the infra for memory and
				context
			</p>
		</main>
	);
}
