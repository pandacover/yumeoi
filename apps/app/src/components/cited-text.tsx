import type { ChatCitation } from "@yumeoi/domain";
import { splitCitedText } from "@yumeoi/memory";

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
					<button
						key={`${index}:cite:${part.index}`}
						type="button"
						className="mx-0.5 align-super text-xs text-[var(--accent)] hover:underline"
						title={citation?.title ?? `Source ${part.index}`}
						onClick={() => citation && onCite?.(citation)}
					>
						[{part.index}]
					</button>
				);
			})}
		</span>
	);
}
