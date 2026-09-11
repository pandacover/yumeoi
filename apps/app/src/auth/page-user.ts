import { auth } from "@clerk/tanstack-react-start/server";
import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

export const requireUserId = async (): Promise<string> => {
	const { isAuthenticated, userId } = await auth();
	if (!isAuthenticated || !userId) {
		throw redirect({ href: "/sign-in" });
	}
	return userId;
};

export const requireAuth = createServerFn({ method: "GET" }).handler(async () => {
	const userId = await requireUserId();
	return { userId };
});
