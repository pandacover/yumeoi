import { Component, type ReactNode } from "react";
import { Show } from "~/components/clerk-ui.ts";

type When = "signed-in" | "signed-out";

class ClerkShowBoundary extends Component<
	{ fallback: ReactNode; children: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };

	static getDerivedStateFromError(): { failed: boolean } {
		return { failed: true };
	}

	render(): ReactNode {
		if (this.state.failed) {
			return this.props.fallback;
		}
		return this.props.children;
	}
}

export function ClerkShow({ when, children }: { when: When; children: ReactNode }) {
	const fallback = when === "signed-out" ? children : null;
	return (
		<ClerkShowBoundary fallback={fallback}>
			<Show when={when}>{children}</Show>
		</ClerkShowBoundary>
	);
}
