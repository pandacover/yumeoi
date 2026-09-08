# yumeoi

Memory infrastructure: connect apps, extract memories, chat with them, and serve them to agents over MCP.

v0 plan: [`docs/v0-plan.md`](docs/v0-plan.md). This tree is **M1** — ingest and recall, no connectors.

## Stack

Cloudflare Workers + Agents SDK, TypeScript, Effect `4.0.0-rc.112`, Bun, TanStack Start, OpenRouter via AI Gateway (OpenAI fallback).

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

Set `YUMEOI_API_KEY` (and optional `YUMEOI_USER_ID`) in `.dev.vars`. Set `OPENROUTER_API_KEY` (default LLM) and optionally `OPENAI_API_KEY` (fallback). Without either LLM key, ingest uses the heuristic extractor so the loop still runs.

`POST /ingest` starts `IngestWorkflow` (realtime lane) and waits for the durable steps to finish.

Workers AI and Vectorize run locally via Wrangler; embeddings against Workers AI need a Cloudflare account.

## Eval (model pins)

```sh
OPENROUTER_API_KEY=… bun run eval:m1
```

`OPENAI_API_KEY` is optional fallback. Without either key, the harness uses the heuristic extractor.

Writes per-document input/output/reasoning tokens plus precision/recall to `docs/eval/m1-results.json` and refreshes `docs/eval/m1.md`.

## Vectorize (remote)

```sh
bun run --filter @yumeoi/app provision:vectorize
```

Creates `yumeoi-memories` at 1024/cosine with metadata indexes `sourceId`, `kind`, `ts`.

## Models

Chat is pinned to **GPT-5.6 Luna**, API id `gpt-5.6-luna` (OpenRouter: `openai/gpt-5.6-luna`), reasoning effort `high`. Calls go to OpenRouter first, then OpenAI.

M1 pins from the eval set (`docs/eval/m1.md`):

- extract: Luna `low`
- consolidate: Luna `low`
- rerank: Luna `none`
