import type { LlmConfig, LlmJobName, ProviderUnavailable, SchemaViolation } from "@yumeoi/domain";
import { Context, type Effect, type Schema } from "effect";

export class Llm extends Context.Service<
	Llm,
	{
		readonly config: LlmConfig;
		readonly structured: <A, I>(options: {
			readonly job: LlmJobName;
			readonly schema: Schema.Codec<A, I>;
			readonly schemaName: string;
			readonly jsonSchema: Record<string, unknown>;
			readonly system: string;
			readonly user: string;
		}) => Effect.Effect<A, ProviderUnavailable | SchemaViolation>;
	}
>()("@yumeoi/memory/Llm") {}
