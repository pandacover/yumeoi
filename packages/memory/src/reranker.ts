import type { ProviderUnavailable } from "@yumeoi/domain";
import { Context, Effect, Layer } from "effect";

export type RerankDocument = {
	readonly id: string;
	readonly text: string;
};

export class Reranker extends Context.Service<
	Reranker,
	{
		readonly score: (
			query: string,
			documents: ReadonlyArray<RerankDocument>,
		) => Effect.Effect<
			ReadonlyArray<{ readonly id: string; readonly score: number }>,
			ProviderUnavailable
		>;
	}
>()("@yumeoi/memory/Reranker") {}

/** Identity ranking — used in tests and when Workers AI is unavailable. */
export const identityRerankerLayer = Layer.succeed(Reranker, {
	score: (_query, documents) =>
		Effect.succeed(
			documents.map((document, index) => ({ id: document.id, score: 1 / (index + 1) })),
		),
});
