# yumeoi

Memory infrastructure: connect apps, extract memories, chat with them, and serve them to agents over MCP.

v0 plan: [`docs/v0-plan.md`](docs/v0-plan.md). This tree is **M4** — MCP OAuth, consent, and the Agents screen. Model pins: [`docs/eval/m1.md`](docs/eval/m1.md).

Next up is the memory v1 plan, [`docs/v1-memory-plan.md`](docs/v1-memory-plan.md) — agent experience, retrieval quality, memory types (semantic / episodic / procedural), graph RAG, temporal and layered tracking, and decay. It takes precedence over v0 M5/M6, which resume after it.

## Stack

Cloudflare Workers + Agents SDK, TypeScript, Effect `4.0.0-rc.112`, Bun, TanStack Start, OpenRouter via AI Gateway (OpenAI fallback).

## Develop

```sh
bun install
cp apps/app/.dev.vars.example apps/app/.dev.vars
bun run dev
```

The Worker serves:

- UI at `/`, `/sources`, `/memories`, `/chat`, `/agents`
- MCP at `/mcp` (OAuth or API key; tools: `search_memories`, `recall_context`, `get_memory`, `get_document`, `add_memory`, `list_sources`)
- MCP OAuth at `/authorize`, `/token`, `/register` (PKCE + dynamic client registration)
- Agents at `/agents/memory-agent/:name` and `/agents/source-agent/:name`
- `POST /ingest`, `/api/search`, `/api/recall`, `/api/sources`, `/api/keys`, `/api/grants` with `Authorization: Bearer ym_…`

Point Cursor or Claude Desktop at `/mcp`. The first connection opens the consent page; connected clients and API keys are managed on **Agents**. Headless agents that cannot do OAuth still send `Authorization: Bearer ym_…`.

Chat uses `AIChatAgent` + `useAgentChat` with tools bound to `recall` and `get_document`. Streaming is resumable. Without an LLM key, chat answers from recalled memories with the same citation marks.

Set `YUMEOI_API_KEY` (and optional `YUMEOI_USER_ID`) in `.dev.vars`. Set `OPENROUTER_API_KEY` (default LLM) and optionally `OPENAI_API_KEY` (fallback). Without either LLM key, ingest uses the heuristic extractor so the loop still runs.

Notion OAuth uses a **public** connection plus `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET`. The Redirect URI in that connection must match `NOTION_REDIRECT_URI` exactly (production: `https://yumeoi.luvmakin01.workers.dev/api/sources/notion/callback`). Internal connections cannot complete this flow. Without those secrets, the Sources screen can still **Connect demo workspace** (fixture connector) to exercise SourceAgent polling.

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

M1 pins from the keyed eval (`docs/eval/m1.md`):

- extract: Luna `high`
- consolidate: Luna `none`
- rerank: Luna `none`
