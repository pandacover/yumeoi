import { Data } from "effect";

export class RateLimited extends Data.TaggedError("RateLimited")<{
	readonly provider: string;
	readonly retryAfterMs?: number;
}> {}

export class ProviderUnavailable extends Data.TaggedError("ProviderUnavailable")<{
	readonly provider: string;
	readonly cause?: unknown;
}> {}

export class SchemaViolation extends Data.TaggedError("SchemaViolation")<{
	readonly message: string;
	readonly issues?: unknown;
}> {}

export class NotFound extends Data.TaggedError("NotFound")<{
	readonly entity: string;
	readonly id: string;
}> {}
