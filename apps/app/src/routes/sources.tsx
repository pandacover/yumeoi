import { createFileRoute, redirect } from "@tanstack/react-router";
import { requireAuth } from "../auth/page-user.ts";

export const Route = createFileRoute("/sources")({
	beforeLoad: async () => {
		await requireAuth();
		throw redirect({ to: "/integrations" });
	},
	component: () => null,
});
