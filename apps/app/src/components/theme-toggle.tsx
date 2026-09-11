import { RiMoonLine, RiSunLine } from "@remixicon/react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button.tsx";

export function ThemeToggle() {
	const { resolvedTheme, setTheme } = useTheme();
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	const dark = mounted && resolvedTheme === "dark";

	return (
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
			disabled={!mounted}
			onClick={() => setTheme(dark ? "light" : "dark")}
		>
			{dark ? <RiSunLine /> : <RiMoonLine />}
		</Button>
	);
}
