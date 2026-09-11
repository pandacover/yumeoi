import { createFileRoute } from "@tanstack/react-router";
import { SignUp } from "../components/clerk-ui.ts";

export const Route = createFileRoute("/sign-up/$")({
	component: Page,
});

function Page() {
	return (
		<div className="flex min-h-svh items-center justify-center px-6">
			<SignUp fallbackRedirectUrl="/agents" path="/sign-up" routing="path" signInUrl="/sign-in" />
		</div>
	);
}
