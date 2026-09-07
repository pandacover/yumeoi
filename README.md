# yumeoi

Memory infrastructure: connect apps, extract memories, chat with them, and serve them to agents over MCP.

v0 plan: [`docs/v0-plan.md`](docs/v0-plan.md). This tree is **M0** — skeleton and spikes.

## Stack

Cloudflare Workers + Agents SDK, TypeScript, Effect `4.0.0-rc.112`, Bun, TanStack Start, OpenAI via AI Gateway.

## Develop

```sh
bun install
bun run dev
```

The Worker serves:

- UI at `/`
- MCP at `/mcp` (tool: `ping`)
- Agents at `/agents/memory-agent/:name`
- Spikes at `/api/health`, `/api/spikes/hello`, `/api/spikes/embed`, `/api/spikes/extract`, `/api/spikes/vectorize`

Copy [`apps/app/.dev.vars.example`](apps/app/.dev.vars.example) to `apps/app/.dev.vars` for OpenAI. Workers AI and Vectorize run locally via Wrangler; embeddings against Workers AI need a Cloudflare account.

## Vectorize (remote)

```sh
bun run --filter @yumeoi/app provision:vectorize
```

Creates `yumeoi-memories` at 1024/cosine with metadata indexes `sourceId`, `kind`, `ts`.

## Chat model

Chat is pinned to OpenAI **GPT-5.6 Luna**, API id `gpt-5.6-luna`, reasoning effort `high`. Extract / consolidate / rerank use the same placeholder until M1.
