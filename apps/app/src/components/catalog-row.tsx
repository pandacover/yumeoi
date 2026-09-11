import type { ReactNode } from "react";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "~/components/ui/item.tsx";

export function CatalogList({ children }: { children: ReactNode }) {
	return <ItemGroup>{children}</ItemGroup>;
}

export function CatalogRow({
	title,
	detail,
	action,
	icon,
}: {
	title: string;
	detail?: string;
	action: ReactNode;
	icon?: ReactNode;
}) {
	return (
		<Item variant="outline">
			{icon ? <ItemMedia variant="icon">{icon}</ItemMedia> : null}
			<ItemContent>
				<ItemTitle>{title}</ItemTitle>
				{detail ? <ItemDescription>{detail}</ItemDescription> : null}
			</ItemContent>
			<ItemActions>{action}</ItemActions>
		</Item>
	);
}
