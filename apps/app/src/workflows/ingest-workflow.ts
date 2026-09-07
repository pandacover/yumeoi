import type { IngestRequest, IngestResult } from "@yumeoi/domain";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "agents/workflows";
import { AgentWorkflow } from "agents/workflows";
import type { MemoryAgent } from "../agents/memory-agent.ts";

export type IngestWorkflowParams = {
	readonly userId: string;
	readonly request: IngestRequest;
};

/**
 * Realtime ingest lane: durable steps around the same Effect pipeline
 * MemoryAgent.ingest runs. Each step.do is retried by Cloudflare Workflows.
 */
export class IngestWorkflow extends AgentWorkflow<MemoryAgent, IngestWorkflowParams> {
	async run(
		event: AgentWorkflowEvent<IngestWorkflowParams>,
		step: AgentWorkflowStep,
	): Promise<IngestResult> {
		const params = event.payload;
		await this.reportProgress({ step: "fetch", status: "running", percent: 0.1 });

		const result = await step.do("ingest", async () => {
			return this.agent.ingest(params.request);
		});

		await this.reportProgress({ step: "commit", status: "complete", percent: 1 });
		await step.reportComplete(result);
		return result;
	}
}
