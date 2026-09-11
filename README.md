# Horizon

Memory infrastructure: connect apps, extract memories, chat with them, and serve them to agents over MCP.

v0 plan: [`docs/v0-plan.md`](docs/v0-plan.md). This tree is **M4** — MCP OAuth, consent, and the Agents screen. Model pins: [`docs/eval/m1.md`](docs/eval/m1.md).

Next up is the memory v1 plan, [`docs/v1-memory-plan.md`](docs/v1-memory-plan.md) — agent experience, retrieval quality, memory types (semantic / episodic / procedural), graph RAG, temporal and layered tracking, and decay. It takes precedence over v0 M5/M6, which resume after it.

## Stack

Cloudflare Workers + Agents SDK, TypeScript, Effect `4.0.0-rc.112`, Bun, TanStack Start, Clerk (app login), OpenRouter via AI Gateway (OpenAI fallback).

## Develop

```sh
bun install
cp apps/app/.dev.vars.example apps/app/.dev.vars
bun run dev
```

Set Clerk keys (`CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`) in `.dev.vars`. The landing page is public. **Get started** sends unsigned-in users through Clerk sign-up; a new Clerk user gets an empty memory store.

The Worker serves:

- UI at `/` (public), plus signed-in `/integrations`, `/memories`, `/chat`, `/agents`
- MCP at `/mcp` (OAuth or API key; tools: `recall`, `search_memories`, `remember`, `update_memory`, `forget`, `feedback`, `get_memory`, `get_document`, `list_sources`, `get_entity`, `timeline`, `changes_since`; `recall_context` / `add_memory` remain as deprecated aliases)
- MCP OAuth at `/authorize`, `/token`, `/register` (PKCE + dynamic client registration; consent requires a Clerk session)
- Agents at `/agents/memory-agent/:name` and `/agents/source-agent/:name` (Clerk session or Bearer key; MemoryAgent name must match the user)
- `POST /ingest`, `/api/search`, `/api/recall`, `/api/remember`, `/api/forget`, `/api/feedback`, `/api/sources`, `/api/keys`, `/api/grants` with `Authorization: Bearer ym_…`
- `GET /api/health` (per-user `memory` stats only when a Bearer key is present)

Point Cursor or Claude Desktop at `/mcp`. Agent-facing guidance lives in [`docs/agents.md`](docs/agents.md) and is also the MCP server `instructions` string. The first connection opens the consent page; connected clients and API keys are managed on **Agents**. Headless agents that cannot do OAuth still send `Authorization: Bearer ym_…`.

Chat uses `AIChatAgent` + `useAgentChat` with tools bound to `recall` and `get_document`. Streaming is resumable. Without an LLM key, chat answers from recalled memories with the same citation marks.

Set `YUMEOI_API_KEY` (and optional `YUMEOI_USER_ID`) in `.dev.vars` for the privileged local Bearer key. Set `OPENROUTER_API_KEY` (default LLM) and optionally `OPENAI_API_KEY` (fallback). Without either LLM key, ingest uses the heuristic extractor so the loop still runs.

Notion OAuth uses a **public** connection plus `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET`. The Redirect URI in that connection must match `NOTION_REDIRECT_URI` exactly (production: `https://yumeoi.luvmakin01.workers.dev/api/sources/notion/callback`). Internal connections cannot complete this flow. Connecting Notion from the UI requires a signed-in Clerk session.

`POST /ingest` starts `IngestWorkflow` (realtime lane) and waits for the durable steps to finish.

Workers AI and Vectorize run locally via Wrangler; embeddings against Workers AI need a Cloudflare account.

## Eval (model pins)

```sh
OPENROUTER_API_KEY=… bun run eval:m1
```

`OPENAI_API_KEY` is optional fallback. Without either key, the harness uses the heuristic extractor.

Writes per-document input/output/reasoning tokens plus precision/recall to `docs/eval/m1-results.json` and refreshes `docs/eval/m1.md`.

## CI and Cloudflare deploy

GitHub Actions:

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — lint, typecheck, tests, and `bun run deploy:dry-run` on every push and pull request.
- [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) — preview Worker version on pull requests; production deploy on push to `main` (or **Actions → Deploy → Run workflow**).

Cloud Agent environment: [`.cursor/environment.json`](.cursor/environment.json) (`bun install --frozen-lockfile`, plus a `dev` terminal). Add the same Cloudflare credentials as Cloud Agent secrets so agents can run Wrangler.

Required GitHub Actions secrets (`Settings → Secrets and variables → Actions`):

| Secret | Used by |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Preview and production Wrangler (Workers Scripts Edit, plus D1 Edit, Vectorize Edit, R2 Edit, KV Edit, Workers AI Edit, Account Settings Read) |
| `CLOUDFLARE_ACCOUNT_ID` | Wrangler account |
| `CLERK_SECRET_KEY` | Production Worker secret for Clerk sessions |
| `CLERK_PUBLISHABLE_KEY` | Production Worker secret, and `VITE_CLERK_PUBLISHABLE_KEY` at build |

OpenRouter, OpenAI, Notion, `YUMEOI_API_KEY`, `YUMEOI_USER_ID`, and `TOKEN_ENCRYPTION_KEY` live as Cloudflare Worker secrets. GitHub may also hold copies; `deploy-prod.sh` only uploads keys that are present in the job env.

Create the API token at [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens). Production deploy runs `bun run deploy` (`apps/app/scripts/deploy-prod.sh`): provision Vectorize metadata indexes, apply D1 migrations, build, then `wrangler deploy` with a secrets file.

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
