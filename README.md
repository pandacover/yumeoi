# yumeoi

Memory infrastructure: connect apps, extract memories, chat with them, and serve them to agents over MCP.

v0 plan: [`docs/v0-plan.md`](docs/v0-plan.md). This tree is **M1** — ingest and recall, no connectors.

## Stack

Cloudflare Workers + Agents SDK, TypeScript, Effect `4.0.0-rc.112`, Bun, TanStack Start, OpenAI via AI Gateway.

## Develop

```sh
bun install
cp apps/app/.dev.vars.example apps/app/.dev.vars
bun run dev
```

The Worker serves:

- UI at `/`
- MCP at `/mcp` (API key required; tools: `search_memories`, `recall_context`, `get_memory`, `get_document`, `add_memory`, `list_sources`)
- Agents at `/agents/memory-agent/:name`
- `POST /ingest` and `/api/search`, `/api/recall` with `Authorization: Bearer ym_…`

Set `YUMEOI_API_KEY` (and optional `YUMEOI_USER_ID`) in `.dev.vars`. OpenAI is optional; without a key, ingest uses the heuristic extractor so the loop still runs.

## Vectorize (remote)

```sh
bun run --filter @yumeoi/app provision:vectorize
```

Creates `yumeoi-memories` at 1024/cosine with metadata indexes `sourceId`, `kind`, `ts`.

## Models

Chat is pinned to OpenAI **GPT-5.6 Luna**, API id `gpt-5.6-luna`, reasoning effort `high`.

M1 pins from the eval set (`docs/eval/m1.md`):

- extract: Luna `low`
- consolidate: Luna `low`
- rerank: Luna `none`
