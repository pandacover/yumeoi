import { RiLoaderLine } from "@remixicon/react";
import { cn } from "cn";

function Spinner({
	className,
	"data-icon": dataIcon,
}: {
	className?: string;
	"data-icon"?: "inline-start" | "inline-end";
}) {
	return (
		<RiLoaderLine
			aria-label="Loading"
			className={cn("size-4 animate-spin", className)}
			data-slot="spinner"
			role="status"
			{...(dataIcon ? { "data-icon": dataIcon } : {})}
		/>
	);
}

export { Spinner };
