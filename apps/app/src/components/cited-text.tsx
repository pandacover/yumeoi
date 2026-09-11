import type { ChatCitation } from "@yumeoi/domain";
import { splitCitedText } from "@yumeoi/memory";
import { CitationPopover } from "~/components/citation-popover.tsx";
import { Button } from "~/components/ui/button.tsx";

export function CitedText({
	text,
	citations,
}: {
	text: string;
	citations: ReadonlyArray<ChatCitation>;
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
					<CitationPopover key={`${index}:cite:${part.index}`} citation={citation}>
						<Button
							className="align-super"
							size="xs"
							title={citation?.title ?? `Source ${part.index}`}
							type="button"
							variant="link"
						>
							[{part.index}]
						</Button>
					</CitationPopover>
				);
			})}
		</span>
	);
}
