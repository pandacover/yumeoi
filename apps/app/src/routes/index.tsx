import { createFileRoute, Link } from "@tanstack/react-router";
import { faqGroups, howItWorks } from "../content/landing.ts";

export const Route = createFileRoute("/")({
	component: Home,
});

function Home() {
	return (
		<main className="landing">
			<section className="landing-hero">
				<p className="hero-kicker">Yumeoi is a continual learning infrastructure for agents</p>
				<h1 className="hero-heading">Give your agents memories they never forget</h1>
				<Link to="/agents" className="ui-btn">
					Get started
				</Link>
			</section>

			{/* biome-ignore lint/correctness/useUniqueElementIds: landing hash target */}
			<section id="how-it-works" className="landing-block">
				<h2 className="section-heading">How it works</h2>
				<p className="section-lead">
					Yumeoi sits beside your agents. It ingests what you already write, turns it into a typed
					memory store, and serves the same recall path to chat, HTTP, and MCP.
				</p>
				{howItWorks.map((item) => (
					<article key={item.id} id={item.id} className="landing-sub">
						<h3 className="sub-heading">{item.title}</h3>
						<p className="body-copy">{item.body}</p>
					</article>
				))}
			</section>

			{/* biome-ignore lint/correctness/useUniqueElementIds: landing hash target */}
			<section id="faq" className="landing-block">
				<h2 className="section-heading">FAQ</h2>
				{faqGroups.map((group) => (
					<div key={group.id} id={group.id} className="faq-group">
						<p className="faq-group-title">{group.title}</p>
						{group.items.map((item) => (
							<article key={item.q} className="faq-item">
								<h3 className="sub-heading">{item.q}</h3>
								<p className="body-copy">{item.a}</p>
							</article>
						))}
					</div>
				))}
			</section>

			<footer className="site-footer">
				<p className="footer-brand">Singularity</p>
				<p className="footer-meta">Yumeoi is a Singularity product.</p>
			</footer>
		</main>
	);
}
