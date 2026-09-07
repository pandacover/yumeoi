import type { ProviderUnavailable } from "@yumeoi/domain";
import { Context, type Effect } from "effect";

export const EMBEDDING_MODEL = "@cf/baai/bge-m3";
export const EMBEDDING_DIMENSIONS = 1024;

export class Embeddings extends Context.Service<
	Embeddings,
	{
		readonly model: string;
		readonly dimensions: number;
		readonly embed: (
			texts: ReadonlyArray<string>,
		) => Effect.Effect<ReadonlyArray<ReadonlyArray<number>>, ProviderUnavailable>;
	}
>()("@yumeoi/memory/Embeddings") {}
