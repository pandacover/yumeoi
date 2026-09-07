import { dispatch } from "../src/dispatch.ts";

export { MemoryAgent } from "../src/agents/memory-agent.ts";

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return (await dispatch(request, env, ctx)) ?? new Response("not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
