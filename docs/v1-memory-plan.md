# Horizon — memory v1 plan

Agent experience, retrieval quality, memory types, graph, time, and decay.

This plan **replaces** the remaining v0 milestones (M5 Gmail, M6 Obsidian) as the next body of work. It starts from the tree as it exists at the end of M4 (`docs/v0-plan.md`) and is written for an implementing model: every section names the files and symbols it touches, the schema it changes, and the eval gate that decides whether it landed. Read §1 (audit) and §6 (hand-off) before touching code.

Stack is unchanged: Cloudflare Workers + Agents SDK, Effect `4.0.0-rc.112`, DO SQLite + FTS5 per user, Vectorize (`namespace = userId`), Workers AI `bge-m3`, OpenAI GPT-5.6 Luna via OpenRouter/AI Gateway. Nothing here requires a new binding except Vectorize metadata indexes (§2.5).

---

## 0. Scope and shape

Six workstreams, one path:

| # | Workstream | What "done" means |
|---|---|---|
| A | **Agent experience (AX)** | An agent can `remember` and `recall` with one call each, get compact, cited, time-stamped context, correct or forget what it wrote, and never has to think about types, dedupe, or embeddings. |
| B | **Retrieval quality** | Measured Recall@10 / nDCG@10 on a labeled recall set goes up materially; superseded, stale, and duplicate memories stop appearing; latency and tokens per recall go down. |
| C | **Memory types** | Every memory is one of `semantic` / `episodic` / `procedural`, classified at write time (extraction and agent writes) with ≥ 0.85 agreement against a labeled set; types drive retrieval, freshness, and decay. |
| D | **Graph RAG** | Entities and relations are extracted, resolved, stored per user, and used as a third candidate source in recall; multi-hop questions become answerable. |
| E | **Temporal and multi-layer tracking** | Bitemporal memories (`eventAt`, `observedAt`, `validFrom/validTo`), `asOf` recall, timelines, version history, and layer promotion (episodes → semantic summaries → procedures). |
| F | **Decay** | A retention score per memory, lifecycle states, a scheduled sweep that archives/forgets, deletes vectors, and keeps the active set small and fresh without losing truth (documents). |

Everything is **eval-gated**. P0 builds the instrument; no later phase merges without moving (or at least not regressing) a number in `docs/eval/`.

Out of scope for v1: multi-user sharing, graph community detection (Leiden), cross-user entity graphs, learned rerankers, a second vector store. Gmail/Obsidian connectors resume after P6 on top of the new model.

---

## 1. Audit: what the M4 tree actually does

The implementer should treat these as facts about the code, not the v0 plan.

### 1.1 As built

| Area | Reality at M4 |
|---|---|
| Memory row | `memories(id, kind, text, confidence, valid_from, valid_to, supersedes, created_at)` — `packages/cf-runtime/src/migrations.ts`. Six kinds: `fact, preference, decision, task, relationship, event` (`packages/domain/src/schema.ts`). No type, no importance, no event time, no access stats, no lifecycle state. |
| Provenance | `memory_sources(memory_id, source_id, document_id, chunk_id)`. |
| Ingest | `packages/memory/src/ingest.ts`: fetch → normalize → chunk → embed → extract → consolidate → commit, run as `IngestWorkflow` steps via `MemoryAgent.beginIngest/continueIngest`. Hash-diff skips unchanged chunks. |
| Extraction | One structured-output call per chunk (`extractor.ts`, `EXTRACT_SYSTEM`), returns `{kind, text, confidence, validFrom}`. Pinned Luna `high` (`docs/eval/m1.md`). |
| Consolidation | Per new memory: vector top-5 (+ in-batch cosine) → LLM decides `new | duplicate | supersedes`. `supersedes` sets `valid_to` on the old row. No merge/update action. |
| Retrieval | `recall.ts`: FTS5 OR-of-tokens + Vectorize (`topK ≤ 40`, `returnMetadata: "all"`) → RRF (k = 60) → `recencyBoost` (≤ +15 %) → optional LLM listwise rerank (Luna `none`) → pack memories then chunks into a token budget, dedupe chunks by document. |
| Vectorize | Ids `m:{id}` / `c:{id}`, metadata `{sourceId, documentId, kind, ts}`, metadata indexes `sourceId`, `kind`, `ts` (3 of 10). |
| AX surface | MCP tools `search_memories`, `recall_context`, `get_memory`, `get_document`, `add_memory(text, kind?, confidence?)`, `list_sources`; resources `memory://sources`, `memory://recent` (`apps/app/src/mcp/server.ts`). Every result is `JSON.stringify(value, null, 2)`. Chat tools `recall`, `get_document` (`apps/app/src/chat/tools.ts`). HTTP mirrors in `apps/app/src/api/http.ts`. Scopes `memories:read` / `memories:write`. |
| Eval | `docs/eval/m1-set.json` (24 docs, 12 consolidate cases, 8 rerank cases), scorers in `packages/memory/src/eval.ts`, runner `apps/app/scripts/eval-m1.ts`. No retrieval eval (query → expected memories). Rerank cases are saturated (every candidate nDCG 1.0). |
| Tests | `bun test packages` with in-memory layers from `packages/test-kit`; `apps/app/test/m*.test.ts` under `@cloudflare/vitest-pool-workers`. `heuristicLlmLayer` fakes structured outputs by `schemaName` so CI runs without keys. |
| Scheduling | `SourceAgent` uses `scheduleEvery` for polling; `MemoryAgent` schedules nothing yet. |

### 1.2 Defects found in review (fix in P0 unless noted)

| Id | Defect | Where | Consequence |
|---|---|---|---|
| D1 | FTS queries have **no `ORDER BY rank`**; rows come back in rowid order and are cut at `LIMIT 80` before filters are applied in JS. | `memory-repo-sql.ts` `searchMemoryFts`, `searchChunkFts` | Keyword ranking is effectively arbitrary; with filters the list can be starved. |
| D2 | **Superseded memories are still returned.** Nothing filters `valid_to IS NOT NULL`. | `recall.ts`, repo FTS/list queries, Vectorize filter | Agents receive contradicting old and new facts side by side. |
| D3 | `add_memory` **never embeds or upserts a vector**; it inserts a fake document/chunk (`content_hash = memoryId`) and skips consolidation. | `memory-repo-sql.ts` `addMemory` | Agent-written memories are keyword-only, duplicate freely, and pollute `documents`. |
| D4 | `recallContext` **embeds the query twice** (once inside `searchMemories`, once for chunks). | `recall.ts` | 2× Workers AI calls per recall. |
| D5 | **N+1 SQL**: `listMemoriesByIds`, `listChunksByIds`, `provenanceFor`, `chunkMeta`, `memoryTimestamps`, `listMemories` (source filter) loop one query per id. | `memory-repo-sql.ts` | Recall latency scales with candidate count. |
| D6 | `since` filters on `created_at` (ingest time) and Vectorize `ts` (ingest time), never on when something happened. | `recall.ts`, `ingest.ts` | "What happened last week" returns whatever was *ingested* last week. |
| D7 | When a re-ingested document drops a chunk, its `memory_sources` rows are deleted but the **memories stay, orphaned** with no provenance and no expiry. | `memory-repo-sql.ts` `commit` | Store accumulates unverifiable memories. (P6 handles state; P0 marks them.) |
| D8 | FTS tokenizer is default `unicode61` (no stemming); `ftsMatchQuery` ORs every token including stopwords. | `migrations.ts`, `rrf.ts` | "deploying" ≠ "deploy"; "the" matches everything. (P3.) |
| D9 | `returnMetadata: "all"` caps Vectorize `topK` at 50 and returns metadata we immediately discard (we hydrate from SQLite). | `vectorize.ts`, `recall.ts` | Smaller candidate pool, more bytes. (P3: `returnMetadata: "none"`, `topK` up to 100.) |
| D10 | `search_memories` / `recall_context` results are pretty-printed JSON with 36-char UUIDs and full provenance arrays. | `mcp/server.ts` | ~3–5× the tokens an agent needs. (P2.) |

---

## 2. Target memory model (schema v2)

One migration, `0004_memory_model_v2`, registered in `packages/cf-runtime/src/sqlite-do.ts` via `SqliteMigrator.fromRecord`. Every `ALTER TABLE ADD COLUMN` is guarded with `PRAGMA table_info` like `memoryStoreV3Migration` because SQLite has no `ADD COLUMN IF NOT EXISTS`. Graph tables (§2.3) are in the same migration so a store is either v1 or v2, never half.

### 2.1 Types, kinds, states

```ts
// packages/domain/src/schema.ts
export const MemoryType  = Schema.Literals(["semantic", "episodic", "procedural"]);
export const MemoryKind  = Schema.Literals([
  "fact", "preference", "decision", "task", "relationship", "event",   // existing
  "procedure", "rule",                                                 // new, procedural
]);
export const MemoryState = Schema.Literals(["active", "superseded", "dormant", "archived", "forgotten"]);
export const MemoryOrigin = Schema.Literals(["extracted", "agent", "user", "derived", "chat"]);
```

`type` is *what kind of knowledge* it is; `kind` is the fine-grained label agents already filter on. Allowed pairs (enforced in `packages/memory/src/types.ts`, mismatches coerced to the type's default kind):

| type | allowed kinds | default |
|---|---|---|
| `semantic` | fact, preference, relationship, decision | fact |
| `episodic` | event, decision, task | event |
| `procedural` | procedure, rule, task | procedure |

`decision` appears twice on purpose: the *act* of deciding is episodic (has an `eventAt`); the *standing outcome* ("we use Effect 4") is semantic. Extraction emits both when the chunk supports both (§3.3). `task` is episodic when one-off (has a due/at time), procedural when recurring ("every Monday…").

### 2.2 The memory row

```sql
ALTER TABLE memories ADD COLUMN type            TEXT    NOT NULL DEFAULT 'semantic';
ALTER TABLE memories ADD COLUMN state           TEXT    NOT NULL DEFAULT 'active';
ALTER TABLE memories ADD COLUMN importance      REAL    NOT NULL DEFAULT 0.5;   -- 0..1, LLM-estimated, feedback-adjusted
ALTER TABLE memories ADD COLUMN event_at        INTEGER;                        -- ms epoch; when it happened (episodic) or null
ALTER TABLE memories ADD COLUMN observed_at     INTEGER;                        -- ms epoch; when we learned it (= created_at on backfill)
ALTER TABLE memories ADD COLUMN updated_at      INTEGER;
ALTER TABLE memories ADD COLUMN last_accessed_at INTEGER;
ALTER TABLE memories ADD COLUMN access_count    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN retention       REAL    NOT NULL DEFAULT 1.0;   -- written by the decay sweep (§3.6)
ALTER TABLE memories ADD COLUMN origin          TEXT    NOT NULL DEFAULT 'extracted';
ALTER TABLE memories ADD COLUMN client_ref      TEXT;                           -- idempotency key for agent writes
CREATE UNIQUE INDEX IF NOT EXISTS memories_client_ref ON memories(client_ref) WHERE client_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS memories_state_type ON memories(state, type);
CREATE INDEX IF NOT EXISTS memories_event_at   ON memories(event_at);
CREATE INDEX IF NOT EXISTS memories_retention  ON memories(state, retention);

CREATE TABLE IF NOT EXISTS memory_edges (      -- replaces the single `supersedes` column going forward (column kept for compat)
  src TEXT NOT NULL, dst TEXT NOT NULL, relation TEXT NOT NULL,   -- supersedes | derived_from | contradicts | elaborates | same_episode
  created_at INTEGER NOT NULL,
  PRIMARY KEY (src, dst, relation)
);
CREATE TABLE IF NOT EXISTS memory_history (    -- every text/validity change; the row itself keeps a stable id
  id TEXT PRIMARY KEY NOT NULL, memory_id TEXT NOT NULL,
  text TEXT NOT NULL, type TEXT NOT NULL, kind TEXT NOT NULL, confidence REAL NOT NULL,
  valid_from TEXT, valid_to TEXT, state TEXT NOT NULL,
  changed_at INTEGER NOT NULL, reason TEXT NOT NULL              -- merge | supersede | correct | decay | restore | forget
);
CREATE TABLE IF NOT EXISTS memory_feedback (
  id TEXT PRIMARY KEY NOT NULL, memory_id TEXT NOT NULL, client_id TEXT NOT NULL,
  signal INTEGER NOT NULL,                                       -- +1 useful, -1 not useful / wrong
  note TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memories_archive ( /* identical column list to memories, incl. PRIMARY KEY (id) */ );
-- declare the columns explicitly (CREATE TABLE … AS SELECT drops constraints); rows move here on archive (§3.6)
```

Backfill inside the migration:

```sql
UPDATE memories SET type = CASE kind WHEN 'event' THEN 'episodic' WHEN 'task' THEN 'episodic' ELSE 'semantic' END;
UPDATE memories SET state = CASE WHEN valid_to IS NOT NULL THEN 'superseded' ELSE 'active' END;
UPDATE memories SET observed_at = created_at, updated_at = created_at, importance = confidence;
UPDATE memories SET origin = 'agent' WHERE id IN (SELECT memory_id FROM memory_sources ms JOIN sources s ON s.id = ms.source_id WHERE s.kind = 'agent');
INSERT OR IGNORE INTO memory_edges (src, dst, relation, created_at) SELECT id, supersedes, 'supersedes', created_at FROM memories WHERE supersedes IS NOT NULL;
```

Domain `Memory` gains the same fields (camelCase) plus `entities: ReadonlyArray<{id, name, type}>` populated at read time. **Ids**: new memories use `m_` + 12 lowercase Crockford base32 chars (60 bits) from `crypto.getRandomValues`; entities `e_…`, relations `r_…`. Existing UUID ids remain valid. Vectorize ids stay `m:{id}` / `c:{id}` and add `e:{id}`.

### 2.3 Graph tables (used from P4, created in 0004)

```sql
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, canonical TEXT NOT NULL,   -- canonical = normalized lookup key
  type TEXT NOT NULL,                       -- person | org | project | place | tool | topic | document | other
  description TEXT,                         -- rolling entity summary (layer L3, §3.5)
  first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, mention_count INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'active'
);
CREATE UNIQUE INDEX IF NOT EXISTS entities_canonical ON entities(canonical, type);
CREATE TABLE IF NOT EXISTS entity_aliases (alias TEXT NOT NULL, entity_id TEXT NOT NULL, PRIMARY KEY (alias));
CREATE TABLE IF NOT EXISTS memory_entities (
  memory_id TEXT NOT NULL, entity_id TEXT NOT NULL, role TEXT NOT NULL,        -- subject | object | mention
  PRIMARY KEY (memory_id, entity_id)
);
CREATE INDEX IF NOT EXISTS memory_entities_entity ON memory_entities(entity_id);
CREATE TABLE IF NOT EXISTS relations (
  id TEXT PRIMARY KEY NOT NULL, src_entity TEXT NOT NULL, dst_entity TEXT NOT NULL, predicate TEXT NOT NULL,
  memory_id TEXT NOT NULL,                  -- evidence memory
  valid_from TEXT, valid_to TEXT, confidence REAL NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS relations_src ON relations(src_entity);
CREATE INDEX IF NOT EXISTS relations_dst ON relations(dst_entity);
CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(name, description, content='entities', content_rowid='rowid');
-- plus insert/update/delete triggers mirroring memories_fts
```

### 2.4 Structured-output shape (one call per chunk)

Extraction, classification, entity and relation extraction happen in **one** structured-output call so the richer model does not multiply LLM cost. OpenAI strict mode requires every field present (use `Schema.NullOr`, never optional).

```ts
export const ExtractedEntity   = Schema.Struct({ name: Schema.String, type: EntityType });
export const ExtractedRelation = Schema.Struct({ subject: Schema.String, predicate: Schema.String, object: Schema.String });
export const ExtractedMemory = Schema.Struct({
  type: MemoryType, kind: MemoryKind, text: Schema.String,
  confidence: Schema.Finite, importance: Schema.Finite,
  eventAt: Schema.NullOr(Schema.String),      // ISO-8601 when the chunk states when it happened
  validFrom: Schema.NullOr(Schema.String),
  entities: Schema.Array(ExtractedEntity),
  relations: Schema.Array(ExtractedRelation),
});
```

`packages/domain/src/json-schema.ts` wraps `Schema.toJsonSchemaDocument`; add a unit test asserting the generated schema for `ExtractedMemories` has `additionalProperties: false` and a complete `required` list at every nesting level (OpenAI strict mode rejects it otherwise), and add a post-processing pass if Effect's output falls short for the nested `entities`/`relations` arrays.

### 2.5 Vectorize metadata

Metadata written on every `m:` vector becomes `{ sourceId, kind, type, state, ts, eventAt, validTo }` where `ts = observedAt`, `eventAt = event_at ?? observed_at`, `validTo = valid_to ?? 8640000000000000` (max date sentinel so `$gte now` means "still valid"). Chunk vectors keep `{ sourceId, kind: "chunk", ts }`. Entity vectors `{ kind: "entity", type }`.

Metadata indexes go from 3 to 7 (limit 10): `sourceId` `kind` `ts` (existing) + `type` `state` `eventAt` `validTo`. Vectorize only filters on properties whose index existed **before** the vector was inserted, so P1 ships both:

- `apps/app/scripts/provision-vectorize.sh` adds `wrangler vectorize create-metadata-index yumeoi-memories --property-name=<p> --type=<string|number>` for the four new properties.
- `MemoryAgent.reindex()` (callable, also `POST /api/admin/reindex`) re-upserts every active memory/chunk vector from SQLite in batches of ≤ 1000 with the new metadata and deletes ids for non-active rows via `deleteByIds`. Runs under `this.schedule` in slices of ~500 rows so a big store never exceeds a single DO request.

Queries switch to `returnMetadata: "none"` (we hydrate from SQLite) which lifts `topK` from 50 to 100.

---

## 3. Workstreams

### 3.1 A — Agent experience

**Principle**: the agent supplies intent; the system supplies structure. An agent should never pick a type, compute a hash, dedupe, or parse nested JSON to use memory.

#### Tool contract v2

Defined once as Effect Schema in `packages/domain/src/tools.ts` (`ToolInput`/`ToolOutput` per tool); MCP zod schemas in `apps/app/src/mcp/server.ts`, HTTP decoders in `apps/app/src/api/http.ts`, and chat tools in `apps/app/src/chat/tools.ts` all mirror it, with a unit test that decodes every MCP zod example through the Effect schema to keep them in lockstep.

| Tool | Input (all optional unless bold) | Output | Notes |
|---|---|---|---|
| `recall` | **`query`**, `budgetTokens` (default 1500), `types[]`, `kinds[]`, `sources[]`, `from`/`to` (event time), `asOf`, `entities[]`, `include: ("memories"|"evidence"|"entities"|"conflicts")[]`, `format: "markdown"|"json"` (default markdown), `plan: "fast"|"full"` | Packed context block (§3.2 step 7) with numbered citations, `why` flags, and a footer of ids | Replaces `recall_context`; keeps the old name as an alias for one phase. `readOnlyHint: true`. |
| `search_memories` | **`query`**, same filters, `limit`, `cursor`, `includeDormant` | Flat ranked list, compact lines | Raw list for agents that want to page. |
| `remember` | **`text`** or **`items[]`** (batch ≤ 20), per item: `type`, `kind`, `importance`, `eventAt`, `validFrom`, `entities[]`, `clientRef`; top-level `dedupe` (default true), `mode: "extract"|"verbatim"` | Per item `{ action: "created"|"merged"|"duplicate"|"superseded"|"conflict", id, text, type, kind, affected[] }` | Runs the single write path (§3.3). `mode: "extract"` lets an agent hand in a paragraph and get several memories back. `clientRef` makes retries idempotent. Scope `memories:write`. |
| `update_memory` | **`id`**, `text`, `validTo`, `importance`, `kind`, `eventAt` | Updated memory + history id | Keeps the id stable; writes `memory_history` (`reason = correct`). |
| `forget` | **`id`** or **`query`** + **`confirm: true`**, `reason` | Ids moved to `forgotten` | Soft; hard-deleted by the sweep after 30 days. Only memories with `origin ∈ {agent, user, chat}` or explicit `confirm` on extracted ones. `destructiveHint: true`. |
| `feedback` | **`id`**, **`signal: 1|-1`**, `note` | ack | Feeds importance and decay (§3.6). Cheap way for an agent to say "that was wrong/useful". |
| `get_memory` / `get_document` | **`id`** | Full record (memory includes history, edges, entities, provenance) | Progressive disclosure: `recall` gives short ids, these give depth. |
| `get_entity` (P4) | **`name`** or **`id`**, `hops` (≤ 2) | Entity summary, relations, recent memories | |
| `timeline` (P5) | **`about`** (entity or topic), `from`, `to`, `limit` | Chronological episodic memories + version changes | |
| `changes_since` (P5) | **`since`** | Created/updated/superseded/forgotten ids since a timestamp | For agents that mirror memory locally. |
| `list_sources` | — | unchanged | |

MCP additions: tool `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`), a server `instructions` string that explains *when* to call `recall` vs `search_memories` and how to use `remember`, resources `memory://profile` (the top-N stable semantic memories about the user, i.e. layer L3), `memory://procedures`, `memory://entities`, and one MCP prompt `context-for-task` that wraps `recall` with a task description.

#### Output format

Markdown lines, not JSON dumps (fixes D10). One memory:

```
[3] (semantic·preference, conf .92, seen 2026-08-30, src Notion "Effect notes") Luv prefers Effect 4 for the yumeoi domain layer. — why: kw+vec
```

Episodic lines carry the event date first; conflicts render as a pair with `⚠ conflicts with [7]`. The footer lists `ids: m_3f9k…=[1], …` so a follow-up `get_memory`/`feedback` needs no parsing. `format: "json"` returns the typed `RecallResult` for programmatic clients. Target: ≥ 40 % fewer tokens per recall than M4 at equal budget.

#### Errors

Typed, actionable: `{ error: "not_found" | "invalid_input" | "scope_required" | "rate_limited" | "conflict", hint }`. `remember` with a `clientRef` seen before returns the original result with `action: "duplicate"` and `idempotent: true`.

#### Files

`packages/domain/src/tools.ts` (new), `apps/app/src/mcp/server.ts`, `apps/app/src/api/http.ts`, `apps/app/src/chat/tools.ts`, `packages/memory/src/format.ts` (new, markdown packer), `apps/app/src/agents/memory-agent.ts` (new callables `remember`, `updateMemory`, `forget`, `feedback`, `changesSince`), `README.md` tool list.

#### AX eval

`apps/app/scripts/eval-ax.ts`: ~15 scripted agent scenarios ("remember these three things from this paragraph, then answer X", "correct a wrong fact", "what did we decide about Y in August") run with the `ai` SDK against an in-memory `MemoryAgent`-equivalent using the tool set, model Luna `none`. Metrics: task success (assertion on final answer), tool calls per task, total tokens. Gate for P2: success ≥ 0.9, tokens per recall −40 % vs M4 JSON output.

### 3.2 B — Retrieval quality

Rewrite `packages/memory/src/recall.ts` into `packages/memory/src/retrieval/{plan,candidates,fuse,rerank,pack}.ts` with `recall.ts` as the composition root. Stages:

1. **Plan** (`plan.ts`). Turn the query into `QueryPlan = { text, terms[], temporal: {from,to}|null, asOf, typeWeights: Record<MemoryType, number>, entities[], intent: "lookup"|"howto"|"history"|"who"|"open" }`. Rules first: relative/absolute dates (`last week`, `in March`, ISO dates), question words (`how do I` → howto/procedural; `when did` / `what happened` → history/episodic; `who` → who/relationship+entities), quoted phrases → exact FTS terms, stopword removal for FTS. `plan: "full"` adds one LLM call (`job: "query"`, Luna `none`) that also expands synonyms and names entities; result cached in DO SQLite `query_cache(hash, plan, expires_at)` for 1 h. Chat passes `fast` (the chat model already phrases the query); MCP default is `fast`, agents can ask for `full`.
2. **Candidates** (`candidates.ts`), all lists fetched with `Effect.all({ concurrency: "unbounded" })` and the query embedded **once** (fixes D4):
   - FTS memories: `porter unicode61 remove_diacritics 2` tokenizer, `bm25(memories_fts)` ordering, filters (`state`, `type`, `kind`, `source`, event window) pushed into SQL, `LIMIT 50` (fixes D1, D8). Requires dropping and recreating the FTS tables in a `0005_fts_porter` migration followed by `INSERT INTO memories_fts(memories_fts) VALUES('rebuild')`.
   - Vector memories: `topK = 100`, `returnMetadata: "none"`, filter `{ state: "active", type: {$in}, eventAt: {$gte,$lte}, validTo: {$gte: asOf ?? now} }` (fixes D2, D6, D9).
   - FTS chunks and vector chunks (same fixes), only when `include` has `evidence`.
   - Graph neighbours (P4): memories attached to seed entities and their 1–2 hop neighbours.
   - Recent episodic window when `intent = history` and no temporal filter: last 30 days by `event_at`.
3. **Fuse** (`fuse.ts`). Weighted RRF, `score = Σ w_list / (k + rank)`, initial weights FTS 1.0, vector 1.0, graph 0.7, recent 0.5, `k = 60`; weights live in `RetrievalConfig` and are tuned on the recall set. Then hard filters that Vectorize could not express (validity vs `asOf` uses `observed_at ≤ asOf AND (valid_from IS NULL OR valid_from ≤ asOf) AND (valid_to IS NULL OR valid_to > asOf)`). Then multiplicative adjustments:
   - `× (0.5 + 0.5·confidence)`
   - `× (0.7 + 0.6·importance)`
   - `× freshness_type(age)` with `age = now − (event_at ?? observed_at)`, half-lives episodic 30 d, semantic 365 d, procedural none (replaces the flat `recencyBoost`)
   - `× typeWeights[type]` from the plan (e.g. howto → procedural 1.4, episodic 0.7)
4. **Dedupe**. Drop evidence chunks whose id is already cited by a packed memory unless `include` has `evidence` explicitly; collapse memories connected by `same_episode`/`elaborates` edges to the highest scorer; do not show both ends of a `supersedes` edge.
5. **Rerank** (`rerank.ts`). Top-30 through Workers AI `@cf/baai/bge-reranker-base` (`{ query, contexts: [{text}] }`, colocated, $0.0031/M input tokens, tens of ms) and blend `0.6·rerank + 0.4·fused`. LLM listwise rerank (existing `RerankResult`) stays available as `rerank: "llm"` for chat if the eval says it helps; the P3 eval decides the default. Add `Reranker` service to `packages/memory` with a Workers AI layer in `cf-runtime` and an identity layer in `test-kit`.
6. **Diversify**. MMR with λ = 0.7 on the top-N using cosine over memory vectors already in hand (fetch with `returnValues` only for the top-30 slice, which is under the 50 cap).
7. **Pack** (`pack.ts`). Budget-aware: memories first (highest score), then entity/relation lines (P4), then evidence chunks; every line as in §3.1. Record `why` flags from which lists contributed.
8. **Access tracking**. One `UPDATE memories SET access_count = access_count + 1, last_accessed_at = ? WHERE id IN (…)` for packed ids; dormant memories that get packed flip back to `active` (§3.6).

Repo changes (`packages/memory/src/memory-repo.ts`, `packages/cf-runtime/src/memory-repo-sql.ts`, `packages/test-kit/src/memory-store.ts`): `listMemoriesByIds`/`listChunksByIds`/`provenanceFor`/`chunkMeta` batched with `sql.in` (fixes D5); `searchMemoryFts(plan, filters)` returns `{id, bm25}`; new `recordAccess(ids)`, `listByEntities(entityIds, filters)`.

**Recall eval** (`docs/eval/recall-set.json`, built in P0): a corpus of ~40 documents (dated; overlapping people and projects; three facts that change over time; two procedures; newsletters as noise) plus ~80 queries, each with expected memory identities expressed as `{ contains, type?, kind? }` matchers (memory ids are not stable across runs) and, for temporal cases, `asOf`. Runner `apps/app/scripts/eval-recall.ts` ingests the corpus through `ingestDocument` with `test-kit` layers (hash embeddings, in-memory Vectorize, heuristic LLM) for a deterministic CI number and, when `OPENROUTER_API_KEY`/Cloudflare credentials are present, through Workers AI embeddings and Luna for the real number recorded in `docs/eval/recall.md`. Metrics: Recall@5, Recall@10, MRR, nDCG@10, context precision (fraction of packed lines that are expected), tokens per recall, p50 latency of the non-LLM path. Also harden `docs/eval/m1-set.json` rerank cases with near-miss distractors until at least one candidate scores < 0.9.

### 3.3 C — Memory types: generation and classification

#### Definitions the prompt and the eval share

| type | It is… | Must carry | Written as |
|---|---|---|---|
| **semantic** | A timeless statement about the world or the user: facts, preferences, relationships, standing decisions. | `validFrom` when stated | Present tense, no date: "Luv prefers Effect 4 for the domain layer." |
| **episodic** | A specific occurrence: something happened, was said, or was decided at a time, with participants. | `eventAt` (fallback: document date, then `observedAt`), participant entities | Past tense with time: "On 2026-09-03 Luv and Anna agreed to ship M4 before the Gmail connector." |
| **procedural** | How to do something, or a rule to follow: steps, triggers, constraints, habits. | trigger/condition when present | "When deploying yumeoi, run `bun run deploy:dry-run` before `deploy:prod`." / "Always cite memories with [n]." |

Decision procedure in `EXTRACT_SYSTEM` (rewritten in `packages/memory/src/extractor.ts`): (1) Is it instructions, a rule, or a repeatable how-to? → procedural. (2) Otherwise, is it tied to a specific moment? → episodic; set `eventAt`. (3) Otherwise → semantic. (4) A decision with both a moment and a standing outcome yields two memories linked by `derived_from`. (5) `importance` 0–1: how much a future assistant would need this (identity, standing preferences, commitments high; incidental detail low).

#### Where classification runs

- **Extraction** (ingest): part of the single structured call (§2.4).
- **Agent writes** (`remember`): if `type` or `kind` is missing, `job: "classify"` with schema `extracted_memory` on the single statement; `mode: "extract"` runs the full extraction schema on the supplied paragraph.
- **Backfill**: rule-based in the migration (§2.2); optional `MemoryAgent.reclassify()` re-runs `classify` over rows with `origin = 'extracted'` in scheduled slices for users who want it.
- **Derived** (P5): promotion/induction jobs set `type` explicitly.

#### Single write path

`packages/memory/src/remember.ts`:

```ts
remember(input: RememberInput) => Effect<RememberOutcome, …>
// idempotency (client_ref) → classify if needed → embed → candidate lookup (vector top-8 + FTS top-8, active only)
// → consolidate v2 → commit (row, edges, history, provenance, entities, relations) → vector upsert → outcome
```

`ingest.ts` `consolidateIngest`/`commitIngest` are refactored to call the same internals in batch form (one transaction per document, in-batch candidates included as today). `MemoryRepo.addMemory` is deleted; `MemoryAgent.addMemory` becomes a thin alias of `remember` for one phase (fixes D3).

#### Consolidation v2

```ts
ConsolidateDecision = { action: "new"|"duplicate"|"supersedes"|"merge"|"contradicts", targetId: string|null, mergedText: string|null, reason: string }
```

- `merge`: update the target's text (history row, re-embed), keep its id. Used when the candidate adds detail to the same fact.
- `contradicts`: both stay active, `contradicts` edge, both `confidence × 0.8`, surfaced by `recall` as a conflict pair. Used when the model cannot tell which is current.
- **Temporal guard** (fixes a class of ordering bugs before backfills exist): a candidate may `supersede` a target only if `candidate.observedAt ≥ target.observedAt` *and* (`candidate.eventAt ?? candidate.documentDate`) ≥ (`target.eventAt ?? target.documentDate`). If the candidate is older, it is stored with `valid_to = target.valid_from ?? target.observed_at` and `state = superseded` on arrival (history is preserved, the present is not overwritten).
- `job: "consolidate"` stays Luna `none` unless the P1 eval shows the new actions need `low`.

#### Types eval

`docs/eval/types-set.json`: ~80 hand-labeled statements (balanced across the three types, including the hard cases: decisions, recurring tasks, preferences phrased as rules) scored by `scoreClassification` in `packages/memory/src/eval.ts` → accuracy and a confusion matrix; `ExpectedMemory` in the extraction set gains `type?`. Gate: accuracy ≥ 0.85, extraction F1 within 0.02 of the M1 pin (0.669) despite the larger schema, cost per document recorded.

### 3.4 D — Graph RAG

Not present in v0 (explicitly out of scope there). v1 adds a **per-user property graph in DO SQLite** (§2.3), populated by the same extraction call, and uses it as a candidate source, an expansion step, and a summary layer. No separate graph database; a single user's graph is thousands of nodes at most, which recursive CTEs handle in milliseconds.

#### Write side

1. Extraction returns `entities[]` and `relations[]` per memory (§2.4).
2. **Entity resolution** (`packages/memory/src/graph/resolve.ts`), per mention, in order: exact `canonical` match (lowercase, diacritics stripped, honorifics/articles removed, same `type`) → `entity_aliases` → embedding similarity over `e:` vectors (`kind: "entity"`, cosine ≥ 0.90) → for `person`/`org` above 0.80 but below 0.90, one `job: "resolve"` call (Luna `none`) with both descriptions to confirm; otherwise create. Never merge two `person` entities on embedding alone.
3. Write `memory_entities` (role from the relation position: subject/object, else mention), `relations` with the memory as evidence and `valid_from` = memory `eventAt ?? validFrom`. A relation whose `(src, predicate)` already has an active row with a different `dst` (e.g. `Anna —works_at→ X` then `—works_at→ Y`) closes the old one (`valid_to`) when the temporal guard allows, mirroring memory supersession.
4. `entities.mention_count`, `last_seen` updated; when `mention_count` crosses 3, 10, 30, … schedule a `summarize` job that rewrites `description` from the entity's current active memories (layer L3, §3.5).

#### Read side

- **Seeds**: `plan.entities` linked through the same resolver (read-only) plus entities of the top-10 fused memories.
- **Expansion**: recursive CTE over `relations` (active as of `asOf`), depth ≤ 2, ≤ 50 nodes, edge weight `confidence × freshness`; collect memories via `memory_entities` for seeds (weight 1.0), 1-hop (0.6), 2-hop (0.3) and feed them into RRF as the graph list (§3.2 step 2).
- **Relation lines** in the packed output: `Anna —works_on→ Project X (since 2026-08, 3 sources) [5]` cite the evidence memory so the agent can drill in.
- `get_entity` tool and `memory://entities` resource (§3.1).

#### Graph eval

Add ~15 multi-hop queries to `docs/eval/recall-set.json` ("who did Luv meet about the project Anna leads?") tagged `graph: true`, and `docs/eval/entities-set.json` with ~60 mention pairs labeled same/different for resolution precision/recall. Gate for P4: multi-hop Recall@10 ≥ 0.75, single-hop metrics not regressed by more than 0.02, resolution precision ≥ 0.9 (false merges are worse than misses).

### 3.5 E — Temporal and multi-layer tracking

#### Bitemporal semantics

| Field | Meaning | Set by |
|---|---|---|
| `eventAt` | When the thing happened (episodic) | extraction / agent |
| `observedAt` | When yumeoi learned it (transaction time) | commit |
| `validFrom` / `validTo` | Interval during which the statement is believed true | extraction, supersession, `update_memory` |
| `updatedAt` | Last row mutation | commit |

`asOf` on `recall`/`search_memories`/`timeline` answers "what did we believe at time T": `observed_at ≤ T` and validity contains T; superseded rows become visible again when `T` predates their `valid_to`. `from`/`to` filter on `event_at ?? observed_at`. Both are pushed to Vectorize (`eventAt`, `validTo` indexes) and SQL.

#### Version history and change feed

Every text/validity/state change writes `memory_history` (§2.2). `get_memory` returns the chain; `changes_since(since)` lists created/updated/superseded/forgotten ids from `updated_at`/history for agents that keep a local mirror.

#### Layers

| Layer | Contents | Producer | Consumer |
|---|---|---|---|
| L0 | documents, chunks (truth) | ingest | evidence in recall, reindex |
| L1 | episodic memories (occurrences) | extraction, chat session summaries | history queries, promotion |
| L2 | semantic memories (facts, preferences, relationships) | extraction, agent writes, promotion | default recall |
| L3 | profile (top stable semantic memories about the user), procedures, entity descriptions | promotion, induction, entity summaries | `memory://profile`, `memory://procedures`, chat system context |

**Promotion** (`packages/memory/src/layers/promote.ts`, run by the nightly sweep): cluster active episodic memories older than 14 days by shared entity + kind (cheap: group by `(entity_id, kind)`, then cosine ≥ 0.8 within group); clusters with ≥ 3 members get one `summarize` call producing a semantic memory (`origin = derived`) with `derived_from` edges to each episode; episodes keep their rows but their `importance` is reduced by 0.2 so decay retires them first. **Procedural induction**: clusters of ≥ 3 episodic `task`/`decision` memories with the same trigger phrase or ≥ 3 `rule`-like instructions across chat sessions produce a `procedural` memory the same way. **Chat sessions**: `MemoryAgent.onChatMessage`'s `onFinish` schedules a `summarize` job that stores at most one episodic memory per turn that contains a decision, commitment, or new preference (`origin = chat`, `eventAt = now`), routed through `remember` so dedupe applies. Profile = top-25 active semantic memories by `importance × retention` with `origin ∈ {agent, user, extracted}` about the user entity (the resolver seeds a `person` entity for the workspace owner from the app user id).

#### Temporal eval

~20 queries in `recall-set.json` with `asOf` and `from/to`, three "fact changed twice" chains, one re-ingest of an older document after a newer one (temporal guard). Gate for P5: 100 % of `asOf` cases return the version valid at T and none of the others; promotion creates summaries with correct `derived_from` edges in the workerd test.

### 3.6 F — Decay, cleanup, freshness

#### Retention score

Computed by the sweep and stored in `memories.retention`:

```
age            = now − max(last_accessed_at, observed_at)
half_life      = { episodic: 30 d, semantic: 365 d, procedural: ∞ }[type]   (∞ → factor 1)
recency        = 0.5 ^ (age / half_life)
use            = 1 + 0.25·ln(1 + access_count) + 0.15·Σfeedback
retention      = clamp(importance^0.5 · confidence · recency · use, 0, 1)
```

Explicit writes (`origin ∈ {agent, user}`) and memories with a `derived_from` child (they have already been summarized) get `importance` floors of 0.6 and 0.3 respectively. Negative feedback (`signal = −1`) subtracts 0.2 from `importance` and, at ≤ 0.1, moves the memory to `dormant` immediately.

#### Lifecycle

```
active ──(retention < 0.25, not accessed 60 d)──▶ dormant ──(retention < 0.10, dormant 90 d)──▶ archived ──(forget/user delete + 30 d)──▶ forgotten (hard delete)
   ▲                                                  │
   └──────────── recalled / feedback +1 / re-observed ─┘
```

- `dormant`: excluded from default recall (`state: "active"` filter), still findable with `includeDormant`; vector kept. Reactivated on access.
- `archived`: row moved to `memories_archive` (so `memories_fts` shrinks), vector deleted with `deleteByIds`, provenance and history kept, `get_memory` still works (reads both tables). Restorable via `update_memory` or the UI.
- `forgotten`: tombstone in `memory_history`, row removed from both tables after 30 days; documents are never touched (they are truth and can rebuild everything).
- **Orphans** (D7): commit marks memories whose last `memory_sources` row was removed as `dormant` with `reason = source_removed`; if the re-ingested document produced a superseding memory the edge is written instead.
- **Exact duplicates** (same normalized text, same type) that slipped past consolidation are merged by the sweep (`reason = merge`).
- **Budget**: `MAX_ACTIVE_MEMORIES` (default 20 000 per user); when exceeded the sweep dormants the lowest-retention active rows until under budget.

#### Scheduling and cost

`MemoryAgent` schedules `sweep` via `this.scheduleEvery(86_400, "sweep")` on first write and cancels it when the user has had no reads or writes for 30 days (re-armed on the next request), so idle users do not wake their DO daily. The sweep runs in slices of 2 000 rows (`this.schedule(1, "sweep", { cursor })`) to stay well inside one DO request; every slice writes progress to `memory_stats` (counts per type/state, last sweep time, vectors deleted) which the UI shows on Memories and which `/api/health` exposes. Fewer live vectors means cheaper Vectorize queries (billed on queried dimensions) and storage.

#### Freshness

Semantic memories whose source document changed (hash-diff already re-extracts the chunk) are re-validated by the consolidation step of that ingest; if the new chunk no longer supports them they follow the orphan path. Semantic memories not re-observed for 2× their half-life get `stale: true` in recall output (`⚠ last confirmed 2025-01`) so agents can decide whether to trust them.

#### Decay eval

A workerd test with a fake clock (inject `now` through a `Clock` service in `packages/memory`) ingests the recall corpus, runs 180 synthetic days of sweeps with a scripted access pattern, and asserts: active set shrinks ≥ 30 %, Recall@10 on queries about still-relevant facts drops ≤ 0.02, every archived memory's vector id was deleted, no document row changed. Gate for P6.

---

## 4. Evaluation harness (cross-cutting)

| Set | File | Scorer | Used by |
|---|---|---|---|
| Extraction (M1, extended with `type`) | `docs/eval/m1-set.json` | `scoreExtraction` | P1 |
| Types | `docs/eval/types-set.json` | `scoreClassification` (new) | P1 |
| Recall (incl. graph and temporal tags) | `docs/eval/recall-set.json` | `scoreRecall` (new: Recall@k, MRR, nDCG@10, context precision, tokens) | P0 baseline, P3, P4, P5, P6 |
| Entities | `docs/eval/entities-set.json` | `scoreResolution` (new) | P4 |
| AX scenarios | `docs/eval/ax-scenarios.json` | `apps/app/scripts/eval-ax.ts` | P2 |

Runners: `bun run eval:recall`, `bun run eval:types`, `bun run eval:ax` (add to root `package.json`). Each writes `docs/eval/<name>-results.json` and refreshes `docs/eval/<name>.md` with the table, the model/effort per job, tokens, cost, and latency, exactly like `docs/eval/m1.md`. Deterministic variants (hash embeddings + heuristic LLM) run in CI as tests so regressions in the non-LLM pipeline (fusion, filters, packing) fail the build; live numbers are recorded when keys are present and are the ones that gate a phase.

New LLM jobs (`packages/domain/src/llm.ts` `LlmJobName`, `defaultLlmConfig`): `classify`, `query`, `resolve`, `summarize`. Each starts on Luna `none` and is pinned by its eval the way M1 pinned the first three. `heuristicLlmLayer` must answer every new `schemaName` (`extracted_memory`, `query_plan`, `resolve_decision`, `summary`) so the key-less path keeps working.

---

## 5. Path

Seven phases, each a PR (or a small stack), each ending with green CI, an updated eval markdown, and a deployable Worker. Dependencies are explicit; P2 can run in parallel with P3, and P4 with P5 after P1.

```
P0 ─▶ P1 ─▶ P2 (AX)
         ├▶ P3 (retrieval) ─▶ P4 (graph) ─▶ P6 (decay)
         └▶ P5 (temporal/layers) ────────▶ P6
```

### P0 — Measure first, fix the obvious

No schema change. Deliverables:

- `docs/eval/recall-set.json` (corpus + queries), `scoreRecall`, `apps/app/scripts/eval-recall.ts`, `bun run eval:recall`; baseline recorded in `docs/eval/recall.md` **before** any retrieval change, deterministic variant added as a `bun test` in `packages/memory`.
- Fix D1 (`ORDER BY rank`, filters in SQL), D2 (exclude `valid_to IS NOT NULL` everywhere, including a `validTo` post-filter on vector hits until P1 adds the metadata index), D4 (embed once), D5 (`sql.in` batching), D3 minimally (`addMemory` embeds and upserts `m:` vectors and runs the existing consolidator), D7 minimally (log orphan count on commit).
- Harden rerank cases in `m1-set.json`.

Done when: baseline table exists, `bun run test` and `bun run --filter @yumeoi/app test` pass, recall numbers after the fixes are recorded alongside the baseline (they should already improve).

### P1 — Memory model v2

- Migration `0004_memory_model_v2` (§2.2, §2.3) with backfill; `Memory`/`ExtractedMemory` schemas (§2.1, §2.4); `json-schema.ts` nested support; short ids.
- Extraction v2 prompt and schema; `packages/memory/src/types.ts` (type/kind matrix, coercion); `classify` job; `docs/eval/types-set.json` + scorer.
- Consolidation v2 (`merge`, `contradicts`, temporal guard) and `remember.ts` single write path; `ingest.ts` refactored onto it; `MemoryRepo.addMemory` removed; `test-kit` store updated.
- Vectorize metadata v2, provisioning script, `MemoryAgent.reindex()`; entity vectors written but not yet queried.
- `heuristicLlmLayer` handles new schemas; `m1`–`m4` workerd tests updated for the new shape; new tests for the migration on a v1 fixture store.

Gate: types accuracy ≥ 0.85 (live), extraction F1 ≥ 0.65 (live), all tests green, `reindex` verified in workerd against the local Vectorize emulator.

### P2 — Agent experience

- `packages/domain/src/tools.ts`, tool contract v2 across MCP/HTTP/chat (§3.1), markdown packer, annotations, `instructions`, resources, prompt, typed errors, `clientRef` idempotency; old tool names kept as aliases and marked deprecated in descriptions.
- `docs/eval/ax-scenarios.json`, `eval-ax.ts`, `bun run eval:ax`.
- README tool section and an agent-facing `docs/agents.md` (how to use the MCP server well; this text is also what `instructions` returns).

Gate: AX success ≥ 0.9, tokens per recall −40 % vs M4, `m4.test.ts` extended to cover `remember`/`forget` via MCP with OAuth and API key.

### P3 — Retrieval quality

- `0005_fts_porter` migration; `retrieval/` pipeline (§3.2); `Reranker` service + Workers AI layer; `RetrievalConfig` with tunable weights; access tracking; `query_cache`.
- Weight/half-life tuning against `recall-set.json`; decide reranker default from the eval.

Gate: nDCG@10 ≥ baseline + 0.10 and Recall@10 ≥ 0.85 (live), context precision ≥ 0.7, p50 non-LLM recall latency < 800 ms in workerd, zero superseded memories in any result.

### P4 — Graph RAG

- Resolver, `graph/` write path in `remember`, relation supersession, entity summaries (`summarize` job), expansion CTE, graph candidate list in fusion, relation lines in packing, `get_entity`, `memory://entities`, Memories UI entity chips.
- `docs/eval/entities-set.json`, multi-hop queries.

Gate: multi-hop Recall@10 ≥ 0.75, resolution precision ≥ 0.9, no single-hop regression > 0.02, extraction cost per document recorded (entities/relations ride in the same call, so expect output tokens up, calls flat).

### P5 — Temporal and layers

- `asOf` end to end (SQL + Vectorize + packing), `timeline`, `changes_since`, `memory_history` surfaced in `get_memory`, promotion and procedural induction jobs, chat session episodics, profile/procedures resources backed by L3.

Gate: temporal cases 100 %, promotion test in workerd, `memory://profile` returns stable semantic memories only.

### P6 — Decay and lifecycle

- `Clock` service, retention scoring, sweep with slices and scheduling policy, `memories_archive`, `deleteByIds`, orphan/duplicate handling, budget, `memory_stats`, Memories UI stats card and restore action, `forget` hard-delete path.

Gate: decay simulation test passes; production sweep observed in Workers logs on the preview deployment for one user store.

### After P6

Resume `docs/v0-plan.md` M5 (Gmail + Batch lane) and M6 (Obsidian) on the v2 model; the Batch lane's extraction requests use the §2.4 schema unchanged.

---

## 6. Hand-off notes for the implementing model

- **Commands**: `bun install`, `bun run lint` (Biome), `bun run typecheck` (`tsgo -b`), `bun test packages`, `bun run --filter @yumeoi/app test` (vitest-pool-workers, needs no keys), `bun run deploy:dry-run` (bundle-size check). CI runs all of these (`.github/workflows/ci.yml`).
- **Effect 4 RC**: exact-pinned `4.0.0-rc.112` everywhere; v4 APIs only (`Context.Service`, `Layer.effect`, `Schema.Struct`/`Literals`/`NullOr`, `effect/unstable/sql`). Keep Effect inside `packages/*`; `MemoryAgent`/`IngestWorkflow` stay thin adapters calling `runtime.runPromise`.
- **DO SQLite**: migrations are idempotent and run in the DO constructor under `blockConcurrencyWhile`; guard `ADD COLUMN` with `PRAGMA table_info`; rebuild external-content FTS tables with `INSERT INTO x_fts(x_fts) VALUES('rebuild')` after recreating them; keep transactions short (`sql.withTransaction`).
- **Structured outputs**: OpenAI strict mode → every property required, `additionalProperties: false`, nullable via `NullOr`. Verify `packages/domain/src/json-schema.ts` output for the nested `ExtractedMemory` arrays (§2.4) before changing the extraction prompt. Every new `schemaName` needs a branch in `heuristicLlmLayer`.
- **Vectorize**: metadata indexes must exist before vectors are inserted to be filterable → provision, then `reindex`. `topK ≤ 100` with `returnMetadata: "none"`, `≤ 50` with values/metadata. Upsert batches ≤ 1000. Deletes via `deleteByIds`. Local dev/test runs the Wrangler emulator; unit tests use `inMemoryVectorIndexLayer` (add `deleteByIds` and `returnValues` support to it and to the `VectorIndex` service).
- **Tests**: pure logic (fusion, freshness, type matrix, retention, packing, planner rules) → `bun test` in `packages/memory` with `test-kit` layers; anything touching DO SQLite, Vectorize, Workflows, MCP/OAuth → `apps/app/test/*.test.ts` in workerd. Add a `p<N>.test.ts` per phase following `m1`–`m4`.
- **Cost discipline**: no new per-chunk LLM calls at ingest (entities/relations/type ride in the extraction call); `classify`/`query`/`resolve`/`summarize` start on Luna `none`; record tokens with `Llm.drainUsage` in every eval runner; keep the static system prompt first for prompt caching.
- **Compatibility**: keep `recall_context`, `add_memory`, `search_memories` shapes working through P2 (aliases), remove in P3. `Memory` gains fields but loses none, so `apps/app/src/routes/memories.tsx` and `chat/tools.ts` compile until they are upgraded.
- **Do not**: put Effect in React; run Leiden/community detection; add a second vector index; delete documents or R2 objects from any sweep; hard-delete memories without the 30-day `forgotten` grace.

---

## 7. Risks and open questions

- **Richer extraction schema raises output tokens.** Entities/relations/type/importance per memory could add 30–60 % output tokens at Luna `high`. Measured in P1; fallback is Luna `medium` for extraction if F1 holds within 0.02, or dropping `relations` from the per-chunk call and extracting them once per document.
- **Type ambiguity** (decision/task/preference-as-rule) caps classification accuracy. The matrix coerces mismatches, and the eval set deliberately over-samples the ambiguous cases; if accuracy stalls below 0.85, allow `type` to be null from the model and fall back to rules.
- **Entity resolution false merges** are worse than misses; thresholds are conservative and persons are never merged on embeddings alone. Provide a `split_entity` admin callable in P4 so mistakes are reversible.
- **Reranker quality**: `bge-reranker-base` is small; if the P3 eval shows the LLM rerank beats it by more than 0.05 nDCG, keep LLM rerank for chat only and the cross-encoder for MCP/HTTP where latency matters.
- **Recursive CTE and sweep CPU** inside a DO: bounded by depth/node caps and 2 000-row slices; measure in workerd and lower the caps if a slice exceeds ~50 ms CPU.
- **Vectorize consistency in tests**: upserts are eventually consistent; workerd tests must poll or use the in-memory layer for ranking assertions.
- **FTS rebuild on migration** is O(n) once per store; fine at v1 volumes, but the migration should run the rebuild in the same `blockConcurrencyWhile` and log its duration.
- **Model availability**: all pins assume `gpt-5.6-luna` on OpenRouter/OpenAI stays available; `defaultLlmConfig` remains the single switch.
- **Open**: should `memory://profile` be injected into the chat system prompt automatically (saves a `recall` round-trip on every turn) or left to the model? Decide in P5 with an AX scenario measuring both.

---

## 8. Decisions

| # | Decision | Choice | Consequence |
|---|---|---|---|
| 1 | Order of work | Eval first (P0), model second (P1), then AX/retrieval in parallel, graph and time, decay last | Every later phase has a number to move; decay needs access stats and layers to exist. |
| 2 | Memory types | `semantic` / `episodic` / `procedural` as a new `type` column, orthogonal to the existing `kind` (+ `procedure`, `rule`) | Agents keep filtering on `kind`; types drive freshness, decay, and routing. |
| 3 | Classification cost | Type, importance, `eventAt`, entities, and relations come from the **one** extraction call | No new per-chunk LLM cost at ingest. |
| 4 | Write path | One `remember()` used by ingest, MCP, HTTP, chat, and derived jobs | Fixes D3 structurally; consolidation and embeddings can never be skipped. |
| 5 | Graph store | Property graph in the user's DO SQLite, entity vectors in the same Vectorize namespace | No new binding, transactional with memories, small enough for CTEs. |
| 6 | Reranker | Workers AI `@cf/baai/bge-reranker-base` first, LLM listwise as an option; eval picks the default | Colocated, cheap, off the OpenAI latency path. |
| 7 | Time | Bitemporal (`eventAt`, `observedAt`, `validFrom/validTo`) with an `asOf` API and a temporal guard in consolidation | Backfills cannot overwrite the present; history is queryable. |
| 8 | Decay | Soft lifecycle states, archive table, vector deletion; never delete documents | Store stays small and fresh; everything is rebuildable. |
| 9 | Ids | Short `m_`/`e_`/`r_` ids for new rows; UUIDs remain valid | Fewer tokens in agent output; no data migration. |
| 10 | Output | Markdown lines by default, JSON on request | Token efficiency is an AX feature, not a formatting preference. |
