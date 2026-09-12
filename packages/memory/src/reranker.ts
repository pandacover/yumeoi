import { ProviderUnavailable } from "@yumeoi/domain";
import { Context, Effect, Layer } from "effect";
import { tokenizeQuery } from "./retrieval/plan.ts";
import { lexicalRerankScores } from "./retrieval/terms.ts";

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

/** Token-overlap ranking so tests can demote keyword-only noise without Workers AI. */
export const lexicalRerankerLayer = Layer.succeed(Reranker, {
	score: (query, documents) => Effect.succeed(lexicalRerankScores(tokenizeQuery(query), documents)),
});

export const unavailableRerankerLayer = Layer.succeed(Reranker, {
	score: () => Effect.fail(new ProviderUnavailable({ provider: "reranker" })),
});
