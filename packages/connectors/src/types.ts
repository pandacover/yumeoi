import type {
	ProviderUnavailable,
	RateLimited,
	SchemaViolation,
	SourceKind,
	Unauthorized,
} from "@yumeoi/domain";
import { Context, type Effect, type Stream } from "effect";

export type ExternalRef = {
	readonly externalId: string;
	readonly contentHash: string;
	readonly lastEditedTime?: string;
};

export type NormalizedDocument = {
	readonly externalId: string;
	readonly title: string;
	readonly markdown: string;
	readonly url: string | null;
	readonly contentHash: string;
};

export type ConnectorAuth = {
	readonly accessToken: string;
	readonly refreshToken?: string | null;
};

export type ConnectorError = RateLimited | ProviderUnavailable | Unauthorized | SchemaViolation;

export class Connector extends Context.Service<
	Connector,
	{
		readonly kind: SourceKind;
		readonly listChanged: (cursor: string | null) => Stream.Stream<ExternalRef, ConnectorError>;
		readonly fetch: (ref: ExternalRef) => Effect.Effect<unknown, ConnectorError>;
		readonly normalize: (raw: unknown) => Effect.Effect<NormalizedDocument, ConnectorError>;
		readonly refreshAuth: () => Effect.Effect<ConnectorAuth | null, ConnectorError>;
	}
>()("@yumeoi/connectors/Connector") {}
