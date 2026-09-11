import { ClerkProvider, SignUp } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sign-up/$")({
	component: Page,
});

function Page() {
	return (
		<ClerkProvider>
			<div className="flex min-h-svh items-center justify-center px-6">
				<SignUp fallbackRedirectUrl="/agents" signInUrl="/sign-in" />
			</div>
		</ClerkProvider>
	);
}
