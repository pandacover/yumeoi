import type { ProviderUnavailable } from "@yumeoi/domain";
import { Context, type Effect } from "effect";

export interface VectorRecord {
	readonly id: string;
	readonly values: ReadonlyArray<number>;
	readonly namespace: string;
	readonly metadata: {
		readonly sourceId: string;
		readonly kind: string;
		readonly ts: number;
	};
}

export interface VectorMatch {
	readonly id: string;
	readonly score: number;
	readonly metadata?: Record<string, unknown>;
}

export class VectorIndex extends Context.Service<
	VectorIndex,
	{
		readonly upsert: (
			records: ReadonlyArray<VectorRecord>,
		) => Effect.Effect<void, ProviderUnavailable>;
		readonly query: (options: {
			readonly values: ReadonlyArray<number>;
			readonly namespace: string;
			readonly topK: number;
		}) => Effect.Effect<ReadonlyArray<VectorMatch>, ProviderUnavailable>;
	}
>()("@yumeoi/memory/VectorIndex") {}
