import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
	component: Home,
});

function Home() {
	return (
		<main className="relative flex min-h-[calc(100vh-4.5rem)] items-center justify-center overflow-hidden">
			<img
				alt=""
				aria-hidden
				className="hero-cosmic pointer-events-none absolute select-none"
				src="/hero-cosmic.png"
			/>
			<div className="relative z-10 flex flex-col items-center gap-3 text-center">
				<h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">yumeoi</h1>
				<p className="text-lg text-[var(--muted)] sm:text-xl">memory for humans and agents</p>
			</div>
		</main>
	);
}
