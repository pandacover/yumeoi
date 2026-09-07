import type { Document, SourceKind } from "@yumeoi/domain";
import { Context, type Effect, type Stream } from "effect";

export interface ExternalRef {
	readonly externalId: string;
	readonly contentHash: string;
}

export class Connector extends Context.Service<
	Connector,
	{
		readonly kind: SourceKind;
		readonly listChanged: (cursor: string | null) => Stream.Stream<ExternalRef>;
		readonly fetch: (ref: ExternalRef) => Effect.Effect<unknown>;
		readonly normalize: (raw: unknown) => Effect.Effect<Document>;
	}
>()("@yumeoi/connectors/Connector") {}
