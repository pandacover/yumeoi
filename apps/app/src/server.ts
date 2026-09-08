import handler from "@tanstack/react-start/server-entry";
import { createYumeoiOAuthProvider } from "./auth/oauth.ts";
import { dispatch } from "./dispatch.ts";

export { MemoryAgent } from "./agents/memory-agent.ts";
export { SourceAgent } from "./agents/source-agent.ts";
export { IngestWorkflow } from "./workflows/ingest-workflow.ts";

const defaultHandler = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const routed = await dispatch(request, env, ctx);
		if (routed) {
			return routed;
		}
		return handler.fetch(request);
	},
} satisfies ExportedHandler<Env>;

export default createYumeoiOAuthProvider(defaultHandler);
