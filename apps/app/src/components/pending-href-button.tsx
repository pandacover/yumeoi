import { type ReactNode, useState } from "react";
import { Button } from "~/components/ui/button.tsx";
import { Spinner } from "~/components/ui/spinner.tsx";

export function PendingHrefButton({
	href,
	children,
	pendingLabel = "Connecting…",
	...props
}: {
	href: string;
	children: ReactNode;
	pendingLabel?: string;
} & Omit<React.ComponentProps<typeof Button>, "nativeButton" | "render" | "children">) {
	const [pending, setPending] = useState(false);

	return (
		<Button
			{...props}
			aria-busy={pending}
			disabled={pending || props.disabled}
			nativeButton={false}
			render={
				// biome-ignore lint/a11y/useAnchorContent: Button children supply the label
				<a
					aria-disabled={pending || undefined}
					href={href}
					onClick={(event) => {
						if (pending) {
							event.preventDefault();
							return;
						}
						setPending(true);
					}}
				/>
			}
		>
			{pending ? <Spinner data-icon="inline-start" /> : null}
			{pending ? pendingLabel : children}
		</Button>
	);
}
