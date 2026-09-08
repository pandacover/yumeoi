import type { NotFound } from "@yumeoi/domain";
import { Context, type Effect } from "effect";

export class ObjectStore extends Context.Service<
	ObjectStore,
	{
		readonly put: (key: string, body: string) => Effect.Effect<void>;
		readonly get: (key: string) => Effect.Effect<string, NotFound>;
	}
>()("@yumeoi/memory/ObjectStore") {}

export const documentObjectKey = (
	userId: string,
	sourceId: string,
	externalId: string,
	contentHash: string,
): string => {
	const safe = (value: string) => value.replaceAll("/", "_");
	return `${safe(userId)}/${safe(sourceId)}/${safe(externalId)}/${contentHash}.json`;
};
