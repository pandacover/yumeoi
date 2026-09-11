# Horizon — v0 plan

Memory infrastructure that connects to the apps you already use (Notion, Gmail, Obsidian, …), turns their contents into memories, lets you chat with those memories, and exposes the same memories to any agent over MCP.

Stack: Cloudflare Workers + Agents SDK, TypeScript, Effect `4.0.0-rc.112`, Bun, TanStack Start, OpenAI behind AI Gateway.

Decisions locked (see §12 for rationale): TanStack Start for the UI; Effect `4.0.0-rc.112`; OpenAI as the LLM vendor with GPT-5.6 Luna at reasoning effort `high` for chat (extraction/consolidation/rerank models chosen at M1 from eval data); eager (ingest-time) memory extraction; one Worker for UI + agents + MCP; DO SQLite FTS5 for keyword search.

---

## 1. v0 scope

The point of v0 is to prove the loop **connect → ingest → remember → recall** end to end for one user, with three consumers of the same memory store: the chat UI, the MCP server, and a plain HTTP API.

In scope:

- One workspace per user (single-tenant per user, no teams/sharing).
- Connectors: **Notion** (OAuth, polling), **Gmail** (OAuth, incremental history sync), **Obsidian** (push-based via a small plugin/CLI, since vaults are local files), plus a generic **`POST /ingest`** endpoint for anything else (webhooks, scripts, curl).
- Ingestion pipeline: normalize → dedupe → chunk → embed → extract memories → index.
- Retrieval: hybrid search (vector + keyword) scoped to the user, filterable by source/time, returned with provenance.
- Chat: streaming chat agent with tool access to the memory store; every answer cites the memories/documents it used.
- MCP server: remote, OAuth-protected, streamable HTTP; tools for search/recall/add/list. Works with Claude Desktop, Cursor, and any MCP client.
- Minimal web UI: connect sources, watch sync status, browse memories, chat.

Explicitly out of scope for v0:

- Multi-user sharing, orgs, RBAC.
- Real-time push from Notion/Gmail (webhooks/Pub-Sub). Polling is fine.
- Memory graph / entity resolution beyond simple tagging.
- Fine-grained per-tool MCP scopes (single `memories:read`/`memories:write` pair).
- Mobile, offline, self-hosting.

---

## 2. Core concepts

| Concept | Meaning |
|---|---|
| **Source** | A connected external app instance (e.g. "Notion workspace X", "gmail: me@…", "Obsidian vault: notes"). Owns credentials and a sync cursor. |
| **Document** | A unit of content pulled from a source: a Notion page, an email thread, a markdown file. Stored raw (R2) plus normalized markdown. Has a stable `externalId` and `contentHash`. |
| **Chunk** | A retrieval-sized slice of a document (~300–800 tokens, overlap). Embedded into Vectorize. Always points back to its document + byte range. |
| **Memory** | An atomic, LLM-extracted statement derived from one or more chunks: a fact, preference, decision, task, relationship, or event. Has `kind`, `text`, `confidence`, `validFrom/validTo`, `supersedes`, and provenance (source, document, chunk ids). Memories are what agents actually consume; chunks are the evidence behind them. |
| **Recall** | A query against memories + chunks scoped to a user, returning ranked results with citations. |

Design rule: **memories are derived, documents are truth.** Anything in the memory layer can be rebuilt from R2 + D1 by re-running ingestion. This keeps v0 safe to iterate on (change the extraction prompt, reindex, no data loss).

---

## 3. Architecture on Cloudflare

```
  Browser ──────────────────┐                     MCP clients (Claude, Cursor, custom agents)
   SSR/HTML, WebSocket      │                                    │ streamable HTTP + OAuth
                            ▼                                    ▼
    ┌──────────────────────────────────────────────────────────────────────────────┐
    │  apps/app — ONE Worker (wrangler main = src/server.ts)                        │
    │                                                                              │
    │  src/server.ts                                                               │
    │    default.fetch → route order:                                              │
    │      /mcp, /authorize, /token, /register  → OAuthProvider(createMcpHandler)  │
    │      /agents/*                            → routeAgentRequest (Agents SDK)   │
    │      /api/*, /ingest                      → Effect HttpApi                   │
    │      everything else                      → TanStack Start handler (UI)     │
    │    named exports: MemoryAgent, SourceAgent, IngestWorkflow                   │
    │                                                                              │
    │  Durable Objects (Agents):                                                   │
    │   • MemoryAgent      1 per user   — memory store, chat, search               │
    │   • SourceAgent      1 per source — creds, cursor, poll loop                 │
    │  Workflows:                                                                  │
    │   • IngestWorkflow   per batch    — normalize→chunk→embed→extract→consolidate│
    └───────┬──────────┬──────────┬──────────────┬─────────────────┬──────────────┘
            ▼          ▼          ▼              ▼                 ▼
         D1        Vectorize      R2      Workers AI (bge-m3)     KV
      control    embeddings    raw docs   + OpenAI via AI       OAuth
      plane      (ns=userId)              Gateway (LLM)         state
```

Why one Worker (decision 5, "whichever is cost efficient"): Workers bill per request and CPU-ms, so splitting UI and core into two Workers adds a second billable request (or a service-binding hop) for every page load that touches the agent, a second cold start, a second deploy, and cross-Worker cookie/auth plumbing — all cost with no v0 benefit. TanStack Start on Cloudflare explicitly supports a custom server entry (`src/server.ts`) that wraps `@tanstack/react-start/server-entry` and re-exports Durable Object and Workflow classes, so the merge is a supported pattern rather than a hack. Static assets are served free from Workers Static Assets. Split later only if the UI bundle starts crowding the 10 MB Worker limit or the two need different deploy cadences.

### 3.1 Durable Objects / Agents

**`MemoryAgent`** — one per user, addressed by `getByName(userId)`. This is the heart of the system.

- Owns the per-user memory store in **DO SQLite**: `documents`, `chunks`, `memories`, `memory_sources` (provenance join), `sync_runs`, and **FTS5** virtual tables over `memories.text` and `chunks.text` for keyword search (DO SQLite ships FTS5; the tables are external-content FTS tables kept in sync by triggers so text is stored once).
- Exposes RPC (`@callable`) methods: `search`, `recall`, `getMemory`, `addMemory`, `listSources`, `getDocument`. These are the *only* read/write path — MCP, HTTP API, and chat all go through them, so scoping and auditing live in one place.
- Extends `AIChatAgent` for the chat surface (streaming, resumable, history persisted in the same DO). Chat tools are thin wrappers over the same RPC methods.
- Receives `IngestWorkflow` completions via `onWorkflowComplete` and writes the extracted memories transactionally.

Why one DO per user rather than a shared store: every query is user-scoped, so the user is the natural coordination atom; DO SQLite gives us transactions and FTS for free; and DO storage limits (10 GB per object) are far above a single user's memory metadata in v0. Raw documents go to R2, not into the DO.

**`SourceAgent`** — one per connected source, addressed by `getByName(sourceId)`.

- Holds encrypted OAuth tokens (refreshes them), the sync cursor (Notion `last_edited_time` watermark, Gmail `historyId`), and status.
- `scheduleEvery(interval, "poll")` drives polling. A poll lists changed items, diffs against known `externalId → contentHash`, and starts an `IngestWorkflow` with the changed batch.
- Also the target for push-based sources: the Obsidian plugin and `POST /ingest` hit the SourceAgent, which validates and forwards to the workflow.
- Deliberately does *not* contain connector-specific logic; it calls the `Connector` service (Effect) for the source's `kind`.

### 3.2 Workflows

**`IngestWorkflow`** (`AgentWorkflow<MemoryAgent, IngestParams>`) — one instance per batch of changed documents. Each `step.do` is durable and retried:

1. `fetch` — pull full content via the connector; write raw payload to R2 (`{userId}/{sourceId}/{externalId}/{contentHash}.json`).
2. `normalize` — convert to markdown + structured metadata (title, authors, timestamps, URL). Connector-specific.
3. `chunk` — heading-aware chunking, ~500 tokens, 15% overlap.
4. `embed` — Workers AI `@cf/baai/bge-m3` (1024-d, multilingual) in batches; upsert to Vectorize with `namespace = userId`, metadata `{ sourceId, documentId, kind, ts }`.
5. `extract` — **eager** (decision 4): runs at ingest time for every changed chunk, so memories are ready the moment a document lands and recall never pays LLM latency. OpenAI structured outputs with a JSON schema generated from the Effect `Memory` schema; prompt asks for atomic, self-contained statements with `kind`, `confidence`, and `validFrom`. Only chunks whose `contentHash` changed are extracted; unchanged chunks keep their existing memories.
6. `consolidate` — for each new memory, vector-search existing memories (top-5, same user) and let the LLM decide `new | duplicate | supersedes(id)`. This is the minimum needed to keep the store from filling with repeats when a Notion page is edited ten times.
7. `commit` — `step.do` that calls `MemoryAgent.commitIngest(batch)` to write documents/chunks/memories/provenance in one SQLite transaction and update the source cursor.

Two execution lanes for the LLM steps, chosen per batch by the `SourceAgent`:

- **Realtime lane** (default for incremental syncs, `/ingest`, Obsidian pushes): synchronous OpenAI calls inside `step.do`, small batches, results visible in seconds.
- **Backfill lane** (initial Notion/Gmail sync, reindex): the workflow writes all extraction requests to an OpenAI **Batch API** job (50% off input and output, 24 h window, separate rate-limit pool), then `step.sleep`s and polls until the batch completes before running `consolidate`/`commit`. The UI shows the source as "backfilling" with a count. Since embeddings and FTS are already indexed after step 4, keyword and chunk-level vector search work immediately; only extracted memories lag.

Progress is streamed to the UI with `reportProgress` → `MemoryAgent.onWorkflowProgress` → `broadcast`.

### 3.3 MCP server

Use **`createMcpHandler`** from `agents/mcp/server` with an MCP SDK v2 `McpServer` factory. `McpAgent` is deprecated and feature-frozen as of Agents SDK 0.20; the stateless handler needs no Durable Object, serves both 2026-07-28 and legacy 2025 clients, and is the recommended path for new servers.

Auth: wrap the Worker in `@cloudflare/workers-oauth-provider` (`apiHandlers: { "/mcp": mcpHandler }`, KV-backed). MCP clients do dynamic client registration + PKCE against `/authorize`, `/token`, `/register`; the authorize page is our own UI where the signed-in user approves the client. Inside tools, `getMcpAuthContext().props.userId` selects the `MemoryAgent`. Also accept a static **API key** (`Authorization: Bearer ym_…`) for headless agents that can't do OAuth; keys live in D1 hashed.

v0 tools (input schemas in zod, mirrored from Effect Schema):

| Tool | Purpose |
|---|---|
| `search_memories` | Hybrid search. `query`, optional `sources[]`, `kinds[]`, `since`, `limit`. Returns memories with provenance and scores. |
| `recall_context` | Higher-level: given a task description, return a compact context block (deduped memories + the top supporting chunks) sized to a token budget. This is the tool agents will actually call before doing work. |
| `get_memory` / `get_document` | Drill into a result; `get_document` returns normalized markdown from R2. |
| `add_memory` | Let an agent write back ("user prefers X"). Tagged `source = agent:{clientId}` so it's filterable/deletable. |
| `list_sources` | What's connected and when it last synced. |

Resources: `memory://sources`, `memory://recent` (last N memories) for clients that support resources.

### 3.4 HTTP API

Same Worker, `/api/*`, dispatched from `src/server.ts` before the request falls through to TanStack Start. Built with Effect `HttpApi` so request/response schemas, OpenAPI, and typed errors come from the same domain definitions used everywhere else. Endpoints mirror the MCP tools plus source management (`POST /api/sources`, OAuth callbacks, `POST /api/sources/:id/sync`) and `POST /ingest` (API-key auth, accepts `{ externalId, title, markdown, metadata }`).

### 3.5 Storage summary

| Store | Holds | Why |
|---|---|---|
| **D1** | users, sessions, sources (non-secret metadata), API keys, MCP client grants, billing later | Relational control plane, queryable across users, Effect `@effect/sql-d1`. |
| **DO SQLite (MemoryAgent)** | documents/chunks/memories metadata, FTS5, chat history | Per-user, transactional, colocated with the agent. `@effect/sql-sqlite-do`. |
| **DO SQLite (SourceAgent)** | encrypted tokens, cursor, last-run status | Isolated blast radius for secrets. |
| **Vectorize** | chunk + memory embeddings, `namespace = userId` | Namespaces are applied before metadata filters, so per-user isolation is cheap. Metadata indexes: `sourceId`, `kind`, `ts` (limit is 10 per index; we use 3). 1024 dims, cosine. |
| **R2** | raw source payloads + normalized markdown | Cheap, rebuildable truth. |
| **KV** | OAuthProvider state, short-lived sync locks | Required by the OAuth library. |
| **Workers AI** | `@cf/baai/bge-m3` embeddings (1024-d) | Colocated, no egress, per-neuron pricing that rounds to nothing at v0 volume; keeps query-time embedding latency inside the Worker. |
| **OpenAI via AI Gateway** | LLM for extraction, consolidation, chat, rerank | Decision 3. Gateway gives caching, logging, per-user cost attribution, and key storage (BYOK) with no code change if the vendor ever changes. Realtime calls for incremental sync and chat; **Batch API** for backfills. |

### 3.6 OpenAI models

**Chat: GPT-5.6 Luna, reasoning effort `high`** (Responses API, `reasoning: { effort: "high" }`), streaming, called through AI Gateway. Luna is OpenAI's cheapest 5.6 tier ($0.20 / $1.20 per 1M input/output after the July 2026 cut, cached input at 10%), which is what makes `high` effort affordable on every user turn. Confirm the exact API id string (`gpt-5.6-luna`) against the OpenAI models page when wiring the `Llm` layer at M0.

**Extraction, consolidation, and rerank: model not yet finalised.** They stay OpenAI (decision 3) but the specific model and effort are chosen at M1 from the eval set, not up front. What is fixed now is the shape of the decision:

| Job | Model / effort | Lane | What the M1 eval decides |
|---|---|---|---|
| Chat | **Luna, `high`** (decided) | Realtime, streaming | Nothing; escape hatch is Terra for chat only if citation quality is insufficient. |
| `extract` (per chunk, high volume) | TBD, structured outputs | Realtime for incremental; Batch for backfill | Dominant cost line. Candidates run against the 20–50 doc eval set scoring memory precision/recall vs. cost per document (input + output + reasoning tokens). Batch lane may use a lower effort than realtime if quality holds. |
| `consolidate` (new / duplicate / supersedes) | TBD | Same as `extract` | Short prompt, 5 candidates, one enum out; likely the same model as `extract` to share prompt cache, but measured separately. |
| LLM rerank (`recall_context`, chat only) | TBD | Realtime | On the latency path of every chat turn, so latency is scored alongside relevance; a low effort setting is the expected outcome. |

The `Llm` service in `packages/memory` takes `{ model, effort }` per job from config, so finalising these later is a settings change, not a code change; M0 wires all four jobs to Luna `high` purely as a placeholder so the pipeline runs end to end while the real choices are measured.

Cost levers baked into the pipeline regardless of which models win: hash-diff so unchanged chunks are never re-extracted; AI Gateway caching for identical prompts; OpenAI prompt caching by keeping the static system prompt and schema first in every request; Batch API (50% off) for all non-interactive work; a per-source daily token budget (input + output + reasoning) enforced in `SourceAgent` that pauses polling when exceeded. Chat and MCP `recall` are the only paths that can never be batched.

---

## 4. Effect: where it lives and how it meets the Workers runtime

Effect owns the domain and services; Cloudflare classes are thin adapters. Concretely:

- **`packages/domain`** — Effect `Schema` for every entity (`Source`, `Document`, `Chunk`, `Memory`, `RecallResult`, tool inputs). One source of truth; derive JSON Schema for MCP tool inputs and OpenAPI from it.
- **`packages/memory`** — pure services (tagged service + `Layer`): `Embeddings`, `VectorIndex`, `MemoryRepo`, `Extractor`, `Consolidator`, `Recall`, `Llm` (wraps the OpenAI client, one implementation for realtime and one for Batch). Typed errors (`RateLimited`, `ProviderUnavailable`, `SchemaViolation`, `NotFound`), `Schedule`-based retries with jitter, `Effect.timeout` on every external call, OpenTelemetry spans via `Effect.withSpan`.
- **`packages/connectors`** — `Connector` interface as an Effect service: `listChanged(cursor) → Stream<ExternalRef>`, `fetch(ref) → RawDocument`, `normalize(raw) → NormalizedDocument`, `refreshAuth`. One implementation per source kind. Each connector is unit-testable with a fake `HttpClient` layer.
- **Adapters** — `MemoryAgent`, `SourceAgent`, `IngestWorkflow`, HTTP handlers, and MCP tool handlers each build a `ManagedRuntime` from the layers above plus a `CloudflareEnv` layer that wraps `env`/`ctx.storage`. Inside a DO, construct the runtime and run SQLite migrations in the constructor under `blockConcurrencyWhile`, never on first request. Handlers do `runtime.runPromise(program)` and nothing else.
- **Version — Effect 4 RC (decision 2).** Install `effect`, `@effect/sql-sqlite-do`, `@effect/sql-d1`, and `@effect/vitest` from the `rc` dist-tag and pin the *exact* RC version in every workspace — **`4.0.0-rc.112`** for `effect`, `@effect/sql-sqlite-do`, `@effect/sql-d1`, and `@effect/vitest`, no ranges — so a `bun install` never mixes RCs; bump deliberately in one PR. Requirements: TypeScript ≥ 5.9 with `strict`, and `tsgo` is recommended for typecheck speed. Because v4 changes several APIs relative to v3 (module names, schema, service definition), rely on the v4 docs rather than v3-era tutorials and blog posts, and keep Effect usage inside `packages/*` so an RC breaking change is fixed in one place. `@effect/platform-cloudflare` (cluster sharding on DOs) is landing in v4 but is not a v0 dependency — Cloudflare Workflows and the Agents SDK already cover durability and scheduling.
- **DO integration pattern** — pass the full `ctx.storage` (not just `storage.sql`) to the `@effect/sql-sqlite-do` layer so transactions and interruption-based rollback work; do not issue `BEGIN`/`COMMIT` yourself. Build the `ManagedRuntime` and run migrations in the DO constructor under `blockConcurrencyWhile`; classify and log initialization failures because a rejected callback resets the object.

Things to *not* do: put Effect in the React components (plain TS + TanStack Query is enough client-side), or try to run Effect Cluster on DOs in v0.

---

## 5. UI: TanStack Start (decided)

**TanStack Start on the Cloudflare Vite plugin (`@cloudflare/vite-plugin`), React 19, Tailwind, shadcn/ui, Agents SDK React hooks — in the same Worker as the agents.**

Why not Next.js: it *does* run on Workers via `@opennextjs/cloudflare`, but you pay for it — a separate build/transform step, `nodejs_compat` shims, a 10 MB gzipped Worker bundle ceiling that Next-sized apps bump into, and framework features landing on Vercel first with the adapter catching up. None of Next's strengths (ISR, image optimization, RSC ecosystem) matter for a logged-in dashboard + chat app.

Why TanStack Start: official Cloudflare partner target, Vite builds (seconds), plain `wrangler deploy`, file-based routing, type-safe loaders, SSR where you want it and SPA where you don't.

Setup details that matter:

- `vite.config.ts` plugin order: `cloudflare({ viteEnvironment: { name: "ssr" } })` **before** `tanstackStart()` before `react()`, or the SSR entry isn't found.
- `wrangler.jsonc` `main` points at our custom `src/server.ts`, not the default `@tanstack/react-start/server-entry`. That file re-exports `MemoryAgent`, `SourceAgent`, `IngestWorkflow` and dispatches `/mcp`, `/agents/*`, `/api/*` before delegating to the Start handler (see §3 diagram).
- Server-side code in routes reaches bindings via `import { env } from "cloudflare:workers"`; UI server functions that need memory data call `env.MemoryAgent.getByName(userId)` RPC rather than HTTP.
- `compatibility_flags: ["nodejs_compat"]` is required by Start and by the OpenAI SDK.
- Keep SSR to the shell and auth-gated route loaders; the Memories, Chat, and Sources views are client-rendered over the agent WebSocket, so most pages are a cheap SSR pass plus static assets (free).

Client ↔ agent: `useAgent({ agent: "MemoryAgent", name: userId })` for state (sync status, source list) and `useAgentChat` for the chat pane. No separate REST calls for the live parts of the UI.

Screens for v0: **Sources** (connect/disconnect, sync status, last error), **Memories** (search, filter by source/kind, open provenance), **Chat**, **Agents** (MCP connection URL, API keys, connected MCP clients with revoke).

---

## 6. Connectors (v0 detail)

| Source | Auth | Change detection | Document unit | Notes |
|---|---|---|---|---|
| **Notion** | OAuth 2 (public integration) | `search` endpoint filtered by `last_edited_time > cursor`, poll every 10 min | Page (blocks flattened to markdown); databases → one document per row | Rate limit ~3 rps; use `Schedule` with backoff. Block → markdown converter is the main work. |
| **Gmail** | Google OAuth, `gmail.readonly` | Initial: `messages.list` with `newer_than:` window (default 90 days). Incremental: `history.list` from stored `historyId`. Poll every 5 min. | Thread (messages concatenated, quoted replies stripped) | Requires Google verification for `restricted` scopes before public launch; fine in testing mode for v0. Skip attachments. |
| **Obsidian** | API key | Push: an Obsidian plugin (or `bun` CLI for the vault dir) watches the vault and POSTs changed files with `contentHash` | Markdown file, frontmatter → metadata, wikilinks preserved as text | Obsidian has no cloud API, so push is the only honest option. The plugin is a small TS project in `apps/obsidian-plugin`. |
| **Generic ingest** | API key | Caller's problem | `{ externalId, title, markdown, metadata }` | This is how Zapier/n8n/scripts plug in. |

All connectors produce the same `NormalizedDocument`; everything downstream is source-agnostic.

---

## 7. Retrieval

`recall(query, filters, budget)`:

1. Embed the query (`bge-m3`).
2. Vectorize query, `namespace = userId`, `topK = 40`, metadata filter for `sourceId`/`kind`/`ts` when provided; run against both memory and chunk vectors (distinguished by `kind` metadata).
3. FTS5 query on DO SQLite for the same filters, top 40.
4. Reciprocal rank fusion, then recency boost (`ts`), then dedupe by `documentId`.
5. Optional LLM rerank of the top 20 when `budget` is small (chat and `recall_context` use this; raw `search_memories` doesn't).
6. Pack into the token budget: memories first, then supporting chunks, each with `{ id, source, url, ts }` citations.

Hybrid matters here: emails and notes are full of exact identifiers (names, invoice numbers, project codenames) that embeddings alone miss.

---

## 8. Auth model

- **App login**: Clerk on TanStack Start. Session cookie → Clerk `user.id` → `MemoryAgent(userId)`. Landing `/` stays public; Get started goes through Clerk. New users start with an empty store.
- **Source OAuth** (Notion, Google): standard authorization-code flow handled in `/api/sources/:kind/callback`; tokens encrypted with a per-deployment key (Workers Secret) and stored in the `SourceAgent`. Notion authorize requires a Clerk session (or Bearer key).
- **MCP OAuth**: `@cloudflare/workers-oauth-provider` acting as the authorization server; our web app renders the consent page after Clerk sign-in; grants recorded in D1 so users can revoke from the Agents screen.
- **API keys**: for `/ingest`, the Obsidian plugin, and headless MCP. Hashed in D1, prefix shown in UI. Bound to the Clerk user id that minted them.

---

## 9. Repository layout (Bun workspaces)

```
yumeoi/
  apps/
    app/                  # The one Worker. wrangler.jsonc lives here.
      src/server.ts       #   custom entry: routes /mcp, /agents/*, /api/* → falls through to Start; exports DO/Workflow classes
      src/agents/         #   MemoryAgent, SourceAgent (thin adapters over packages/*)
      src/workflows/      #   IngestWorkflow
      src/mcp/            #   createMcpHandler factory + tool registrations
      src/api/            #   Effect HttpApi definition + handlers
      src/routes/         #   TanStack Start file routes (UI)
      src/components/     #   React + shadcn
    obsidian-plugin/      # Push connector for local vaults
  packages/
    domain/               # Effect Schema types + errors, shared everywhere
    memory/               # Embeddings, VectorIndex, MemoryRepo, Extractor, Consolidator, Recall
    connectors/           # Connector interface + notion/, gmail/, generic/
    cf-runtime/           # CloudflareEnv layer, ManagedRuntime helpers, sql-sqlite-do / sql-d1 layers
    test-kit/             # Fake layers (HttpClient, Embeddings, Llm) for unit tests
  docs/
```

Tooling: Bun for install/scripts/tests of pure packages; `@cloudflare/vitest-pool-workers` for anything touching DOs/Vectorize/D1 (runs in workerd, not Bun); Biome for lint/format; `wrangler types` for `Env`; `tsgo` for typechecking (Effect 4's recommendation); Turborepo optional once builds get slow. All Effect packages pinned to one exact `rc` version via the root `package.json` `overrides`.

---

## 10. Milestones

Each milestone ends with something deployable and a short demo.

**M0 — Skeleton and spikes**
Monorepo; `apps/app` as a TanStack Start project with custom `src/server.ts` exporting a hello `MemoryAgent`; Effect `4.0.0-rc.112` pinned and `@effect/sql-sqlite-do` running DO SQLite migrations (including the FTS5 tables and sync triggers) in workerd; Vectorize index created (1024/cosine, metadata indexes `sourceId`,`kind`,`ts`); Workers AI embedding round-trip; OpenAI structured-output call through AI Gateway with a schema derived from Effect Schema; `createMcpHandler` serving one `ping` tool through the MCP Inspector from the same Worker as a rendered Start page; `Llm` layer with per-job `{ model, effort }` config, chat pinned to GPT-5.6 Luna `high` with the exact model id confirmed and the other jobs on a placeholder. CI: `tsgo`, Biome, vitest-pool-workers, `wrangler deploy` to a preview.

**M1 — Ingest and recall, no connectors**
`POST /ingest` → `IngestWorkflow` (realtime lane) → chunks/memories/embeddings → `search_memories` and `recall_context` over MCP (API-key auth) and `/api`. This is the first moment an agent in Cursor can use your memories. Extraction and consolidation prompts get their first eval set here (20–50 hand-labeled docs), and this is where the extraction, consolidation, and rerank models are finalised: run the candidate models/efforts against the set, record per-document input, output, and reasoning tokens alongside memory precision/recall, and pin the winners in config (§3.6).

**M2 — Notion connector + web UI Sources screen**
`SourceAgent`, Notion OAuth, block→markdown, polling with cursor, sync status streamed to the UI via `useAgent`. Memories screen with provenance.

**M3 — Chat**
`AIChatAgent` on `MemoryAgent`, `useAgentChat` pane, tools bound to `recall`/`getDocument`, citations rendered inline. Resumable streaming on.

**M4 — MCP OAuth + Agents screen**
`OAuthProvider` in front of `/mcp`, consent page, grant list/revoke, tested against Claude Desktop and Cursor.

> **Status after M4:** M5 and M6 are paused. The next body of work is `docs/v1-memory-plan.md` (agent experience, retrieval quality, memory types, graph RAG, temporal/layered tracking, decay); M5/M6 resume on top of that model.

**M5 — Gmail connector + Batch backfill lane**
Google OAuth, initial backfill window via the OpenAI Batch API lane, `historyId` incremental sync on the realtime lane, thread normalization. This is the volume source, so it is also where the per-source daily budget and cost accounting get exercised for real. (The Batch lane is built here rather than at M2 because Notion workspaces are usually small enough that realtime backfill is acceptable.)

**M6 — Obsidian plugin + hardening**
Plugin publishes vault changes to `/ingest`. Then: rate limiting per key, per-user cost accounting, reindex command, delete-source cascades (DO rows, Vectorize by id list, R2 prefix), basic observability dashboards.

---

## 11. Risks and open questions

- **Eager extraction cost.** Every changed chunk costs an LLM call whether or not anyone ever recalls it; that is the price of instant, complete memories. Mitigations are in §3.6 (hash diff, model/effort chosen on measured cost at M1, Gateway caching, Batch for backfill, per-source daily budget). If a source turns out to be mostly noise (newsletters in Gmail), add per-source include/exclude rules before considering lazy extraction.
- **OpenAI as a single vendor.** Outages or price changes hit extraction and chat at once. AI Gateway keeps the swap to another provider a config change; the `Llm` service interface in `packages/memory` keeps it a one-file change in code. Embeddings stay on Workers AI, so search keeps working even if OpenAI is down.
- **Vectorize consistency and deletes.** Upserts are eventually consistent (seconds). Deleting a source means deleting by id list, which we must track in DO SQLite. Keep the `chunks`/`memories` tables authoritative and treat Vectorize as an index.
- **Extraction model still open.** Extraction is the dominant cost line and its model is not chosen until M1. The risk is choosing on a small eval set and being surprised at Gmail volume (M5). Mitigation: the M1 eval records reasoning tokens per document explicitly (they bill as output and can dominate at higher efforts), and the per-source daily budget caps the damage if the estimate is off.
- **Workers CPU/time limits in the workflow.** Batch embeddings ≤ 100 chunks per step; keep each `step.do` under a few seconds of CPU. Workflows handle the wall-clock side.
- **Gmail scope verification.** `gmail.readonly` is restricted; public launch needs Google's security review. v0 runs in testing mode with allow-listed accounts.
- **Effect 4 RC churn.** RC releases can still change APIs between builds. Exact-pin one version, bump in isolated PRs, keep Effect out of the DO/Workflow class bodies so a breaking change touches `packages/*` only. `@effect/sql-sqlite-do` on v4 has been exercised in workerd (transactions, rollback on typed failure and interruption) but treat it as beta and keep transactions short.
- **Single-Worker bundle size.** UI + Agents SDK + OpenAI SDK + Effect in one Worker. Watch the 10 MB gzipped limit in CI (`wrangler deploy --dry-run --outdir`); the Start plugin already code-splits the client, and `agents/mcp/server` is the isolated entry that keeps MCP client code out of the bundle. Splitting the UI back out is the escape hatch, not the default.
- **Single DO per user hot-spotting.** A very active user's ingest + chat + MCP traffic lands on one object. Fine for v0; if it matters later, move read paths (search) to a separate `RecallAgent` or plain Worker reading Vectorize + D1 replicas.
- **Consent/privacy.** Emails are sensitive. Encrypt tokens, never log document bodies, make "delete everything from source X" a first-class, verified operation before inviting anyone else.

---

## 12. Decisions (resolved)

| # | Decision | Choice | Consequences in this plan |
|---|---|---|---|
| 1 | UI framework | **TanStack Start** on `@cloudflare/vite-plugin` | §5; custom `src/server.ts`; Vite plugin ordering; SSR limited to shell + auth. |
| 2 | Effect version | **Effect `4.0.0-rc.112`** | §4; exact-pin across all `@effect/*` packages, `tsgo`, v4 docs only, Effect confined to `packages/*`. |
| 3 | LLM | **OpenAI** via AI Gateway; **chat = GPT-5.6 Luna, reasoning `high`** | §3.5–3.6; extract/consolidate/rerank models finalised at M1 from the eval set; per-job `{ model, effort }` config; Batch API for backfill; embeddings stay on Workers AI `bge-m3`. |
| 4 | Extraction timing | **Eager** (ingest time) | §3.2 step 5; hash-diff and per-source budgets are the cost controls; recall never waits on an LLM. |
| 5 | Worker topology | **One Worker** (most cost-efficient) | §3 diagram; UI, Agents, Workflows, MCP, OAuth, and API in `apps/app`; single deploy, no cross-Worker requests or auth hops. |
| 6 | Keyword search | **DO SQLite FTS5** (confirmed available) | §3.1, §7; external-content FTS tables with sync triggers; no fallback path needed. |

Nothing blocks M0. Deliberately deferred to M1, where there is eval data to decide with: the OpenAI model and reasoning effort for `extract`, `consolidate`, and rerank (§3.6). Until then they run on a placeholder via config.
