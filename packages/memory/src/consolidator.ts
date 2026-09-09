import {
	ConsolidateDecision,
	consolidateDecisionJsonSchema,
	type Memory,
	type ProviderUnavailable,
	type RateLimited,
	type SchemaViolation,
} from "@yumeoi/domain";
import { Context, Effect, Layer } from "effect";
import { Llm } from "./llm.ts";

export const CONSOLIDATE_SYSTEM = `You decide how a candidate memory relates to existing memories.

Return:
- action=new if it is a distinct statement
- action=duplicate and targetId=existing id if it repeats an existing memory
- action=supersedes and targetId=existing id if it updates and replaces that memory
- action=merge, targetId, and mergedText if it adds detail to the same fact (keep the target id)
- action=contradicts and targetId if both should stay active as a conflict

Only use an id from the candidate list. If none apply, action=new and targetId=null.
mergedText is the combined text for merge, otherwise null.
reason is a short phrase.`;

export class Consolidator extends Context.Service<
	Consolidator,
	{
		readonly decide: (
			candidate: string,
			existing: ReadonlyArray<Memory>,
		) => Effect.Effect<ConsolidateDecision, ProviderUnavailable | RateLimited | SchemaViolation>;
	}
>()("@yumeoi/memory/Consolidator") {}

export const consolidatorLayer = Layer.effect(
	Consolidator,
	Effect.gen(function* () {
		const llm = yield* Llm;
		return {
			decide: (candidate, existing) =>
				llm.structured({
					job: "consolidate",
					schema: ConsolidateDecision,
					schemaName: "consolidate_decision",
					jsonSchema: consolidateDecisionJsonSchema(),
					system: CONSOLIDATE_SYSTEM,
					user:
						existing.length === 0
							? `Candidate:\n${candidate}\n\nExisting memories: none`
							: `Candidate:\n${candidate}\n\nExisting memories:\n${existing
									.map((memory) => `- ${memory.id}: ${memory.text}`)
									.join("\n")}`,
				}),
		};
	}),
);
