import { createFileRoute } from "@tanstack/react-router";
import { SignIn } from "../components/clerk-ui.ts";

export const Route = createFileRoute("/sign-in/$")({
	component: Page,
});

function Page() {
	return (
		<div className="flex min-h-svh w-full items-center justify-center px-6">
			<SignIn fallbackRedirectUrl="/agents" path="/sign-in" routing="path" signUpUrl="/sign-up" />
		</div>
	);
}
