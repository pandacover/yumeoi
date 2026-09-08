import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
	component: Home,
});

function Home() {
	return (
		<main className="flex min-h-screen items-center justify-center px-6">
			<p className="max-w-3xl text-center text-lg sm:text-xl">
				<strong className="font-semibold text-[var(--brand)]">yumeoi</strong> is memory engine for
				agents and humans
			</p>
		</main>
	);
}
