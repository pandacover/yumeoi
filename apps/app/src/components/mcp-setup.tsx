import type { ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button.tsx";

export const copyText = async (ok: string, value: string) => {
	try {
		await navigator.clipboard.writeText(value);
		toast.success(ok);
	} catch {
		toast.error("Could not copy to the clipboard.");
	}
};

export function McpSetup({
	mcpUrl,
	scopes,
	snippet,
	help,
	actions,
}: {
	mcpUrl: string;
	scopes: readonly string[];
	snippet: string;
	help: ReactNode;
	actions?: ReactNode;
}) {
	const scopeLine = scopes.join(" ");
	return (
		<div className="flex flex-col gap-4">
			{help}
			<div className="flex flex-col gap-1">
				<p className="text-xs text-muted-foreground">Horizon MCP URL</p>
				<p className="font-mono text-sm break-all">{mcpUrl}</p>
			</div>
			{scopeLine ? (
				<div className="flex flex-col gap-1">
					<p className="text-xs text-muted-foreground">Scopes</p>
					<p className="font-mono text-sm break-all">{scopeLine}</p>
				</div>
			) : null}
			<div className="flex flex-wrap gap-2">
				<Button size="sm" variant="outline" onClick={() => void copyText("Copied URL", mcpUrl)}>
					Copy URL
				</Button>
				<Button
					size="sm"
					variant="outline"
					onClick={() => void copyText("Copied scopes", scopeLine)}
					disabled={!scopeLine}
				>
					Copy scopes
				</Button>
				<Button size="sm" variant="outline" onClick={() => void copyText("Copied config", snippet)}>
					Copy config
				</Button>
				{actions}
			</div>
			<pre className="overflow-x-auto bg-muted p-3 font-mono text-xs text-muted-foreground">
				{snippet}
			</pre>
		</div>
	);
}
