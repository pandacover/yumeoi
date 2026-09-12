import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "../auth/page-user.ts";
import { UserProfile } from "../components/clerk-ui.ts";
import { Page, PageHeader } from "../components/page.tsx";

export const Route = createFileRoute("/profile/$")({
	beforeLoad: () => requireAuth(),
	component: ProfilePage,
});

function ProfilePage() {
	return (
		<Page wide className="max-w-none">
			<PageHeader title="Profile" description="Account, security, and sign-out." />
			<div className="w-full min-w-0 overflow-x-auto">
				<UserProfile path="/profile" routing="path" />
			</div>
		</Page>
	);
}
