import { createYumeoiOAuthProvider } from "../src/auth/oauth.ts";
import { dispatch } from "../src/dispatch.ts";

export { MemoryAgent } from "../src/agents/memory-agent.ts";
export { SourceAgent } from "../src/agents/source-agent.ts";
export { IngestWorkflow } from "../src/workflows/ingest-workflow.ts";

const defaultHandler = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return (await dispatch(request, env, ctx)) ?? new Response("not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

export default createYumeoiOAuthProvider(defaultHandler);
