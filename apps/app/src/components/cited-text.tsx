import type { ChatCitation } from "@yumeoi/domain";
import { splitCitedText } from "@yumeoi/memory";
import { Button } from "~/components/ui/button.tsx";

export function CitedText({
	text,
	citations,
	onCite,
}: {
	text: string;
	citations: ReadonlyArray<ChatCitation>;
	onCite?: (citation: ChatCitation) => void;
}) {
	const parts = splitCitedText(text);
	return (
		<span className="whitespace-pre-wrap">
			{parts.map((part, index) => {
				if (part.type === "text") {
					return <span key={`${index}:${part.value}`}>{part.value}</span>;
				}
				const citation = citations.find((item) => item.index === part.index);
				return (
					<Button
						key={`${index}:cite:${part.index}`}
						className="align-super"
						size="xs"
						title={citation?.title ?? `Source ${part.index}`}
						type="button"
						variant="link"
						onClick={() => citation && onCite?.(citation)}
					>
						[{part.index}]
					</Button>
				);
			})}
		</span>
	);
}
