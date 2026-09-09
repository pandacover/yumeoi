import type { ProviderUnavailable } from "@yumeoi/domain";
import { Context, type Effect } from "effect";

export interface VectorRecord {
	readonly id: string;
	readonly values: ReadonlyArray<number>;
	readonly namespace: string;
	readonly metadata: {
		readonly sourceId: string;
		readonly documentId?: string;
		readonly kind: string;
		readonly type?: string;
		readonly state?: string;
		readonly ts: number;
		readonly eventAt?: number;
		readonly validTo?: number;
	};
}

export interface VectorMatch {
	readonly id: string;
	readonly score: number;
	readonly metadata?: Record<string, unknown>;
}

export const VALID_TO_SENTINEL = 8_640_000_000_000_000;

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
			readonly filter?: Record<string, unknown>;
		}) => Effect.Effect<ReadonlyArray<VectorMatch>, ProviderUnavailable>;
		readonly deleteByIds: (ids: ReadonlyArray<string>) => Effect.Effect<void, ProviderUnavailable>;
	}
>()("@yumeoi/memory/VectorIndex") {}
