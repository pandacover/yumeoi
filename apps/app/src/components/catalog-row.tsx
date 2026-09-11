import type { ReactNode } from "react";

export function CatalogList({ children }: { children: ReactNode }) {
	return <ul className="catalog-list">{children}</ul>;
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
		<li className="catalog-row">
			<div>
				<p className="catalog-name">{title}</p>
				{detail ? <p className="catalog-detail">{detail}</p> : null}
			</div>
			<div className="catalog-action">{action}</div>
		</li>
	);
}
