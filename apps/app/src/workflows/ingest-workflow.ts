import type { IngestRequest, IngestResult } from "@yumeoi/domain";
import type { INGEST_STEPS } from "@yumeoi/memory";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "agents/workflows";
import { AgentWorkflow } from "agents/workflows";
import type { MemoryAgent } from "../agents/memory-agent.ts";

export type IngestWorkflowParams = {
	readonly userId: string;
	readonly request: IngestRequest;
};

const STEP_PERCENT: Record<(typeof INGEST_STEPS)[number], number> = {
	fetch: 0.12,
	normalize: 0.24,
	chunk: 0.36,
	embed: 0.5,
	extract: 0.68,
	consolidate: 0.84,
	commit: 1,
};

/**
 * Realtime ingest lane. Each §3.2 step is its own durable `step.do` so a retry
 * does not redo fetch/normalize/chunk/embed/extract/consolidate/commit.
 */
export class IngestWorkflow extends AgentWorkflow<MemoryAgent, IngestWorkflowParams> {
	async run(
		event: AgentWorkflowEvent<IngestWorkflowParams>,
		step: AgentWorkflowStep,
	): Promise<IngestResult> {
		const params = event.payload;
		await this.reportProgress({ step: "fetch", status: "running", percent: STEP_PERCENT.fetch });

		let state = await step.do("fetch", async () => {
			return this.agent.beginIngest(params.request);
		});

		if (state.unchanged && state.result) {
			await this.reportProgress({ step: "commit", status: "complete", percent: 1 });
			await step.reportComplete(state.result);
			return state.result;
		}

		for (const name of [
			"normalize",
			"chunk",
			"embed",
			"extract",
			"consolidate",
			"commit",
		] as const) {
			await this.reportProgress({
				step: name,
				status: "running",
				percent: STEP_PERCENT[name],
			});
			state = await step.do(name, async () => this.agent.continueIngest(name, state));
		}

		const result = state.result;
		if (!result) {
			throw new Error("ingest workflow commit did not return a result");
		}
		await this.reportProgress({ step: "commit", status: "complete", percent: 1 });
		await step.reportComplete(result);
		return result;
	}
}
