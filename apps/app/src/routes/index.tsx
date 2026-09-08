import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
	component: Home,
});

function Home() {
	return (
		<main className="flex min-h-screen items-center justify-center">
			<div className="flex flex-col items-center gap-3 text-center">
				<h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">yumeoi</h1>
				<p className="text-lg sm:text-xl">memory engine for agents and humans</p>
			</div>
		</main>
	);
}
