import type { ReactNode } from "react";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "~/components/ui/item.tsx";

export function CatalogList({ children }: { children: ReactNode }) {
	return <ItemGroup>{children}</ItemGroup>;
}

export function CatalogRow({
	title,
	detail,
	action,
}: {
	title: string;
	detail?: string;
	action: ReactNode;
}) {
	return (
		<Item variant="outline">
			<ItemContent>
				<ItemTitle>{title}</ItemTitle>
				{detail ? <ItemDescription>{detail}</ItemDescription> : null}
			</ItemContent>
			<ItemActions>{action}</ItemActions>
		</Item>
	);
}
