"use client";

import {
	RiCheckboxCircleLine,
	RiCloseCircleLine,
	RiErrorWarningLine,
	RiInformationLine,
	RiLoaderLine,
} from "@remixicon/react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ theme: themeProp, ...props }: ToasterProps) => {
	const { theme: hookTheme = "system" } = useTheme();
	const theme = themeProp ?? hookTheme;
	const resolvedTheme = theme === "dark" || theme === "light" ? theme : "system";

	return (
		<Sonner
			theme={resolvedTheme}
			className="toaster group"
			icons={{
				success: <RiCheckboxCircleLine className="size-4" />,
				info: <RiInformationLine className="size-4" />,
				warning: <RiErrorWarningLine className="size-4" />,
				error: <RiCloseCircleLine className="size-4" />,
				loading: <RiLoaderLine className="size-4 animate-spin" />,
			}}
			style={
				{
					"--normal-bg": "var(--popover)",
					"--normal-text": "var(--popover-foreground)",
					"--normal-border": "var(--border)",
					"--border-radius": "var(--radius)",
				} as React.CSSProperties
			}
			toastOptions={{
				classNames: {
					toast: "cn-toast",
				},
			}}
			{...props}
		/>
	);
};

export { Toaster };
