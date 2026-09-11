export const howItWorks = [
	{
		id: "connect",
		title: "Connect sources",
		body: "Yumeoi pulls from the tools you already write in. Notion is live over OAuth. A generic ingest endpoint takes markdown from scripts, webhooks, or curl. Each source keeps a cursor, so sync is incremental instead of a full re-read every time.",
	},
	{
		id: "ingest",
		title: "Ingest, then extract",
		body: "A document is normalized, chunked, embedded, and run through extraction. Unchanged content is skipped by hash. Documents stay the source of truth in object storage. Memories are derived from them, which means the memory layer can be rebuilt without losing the original.",
	},
	{
		id: "memory-model",
		title: "A typed memory model",
		body: "Every memory is semantic, episodic, or procedural — a standing fact, something that happened, or a way of doing things. Finer kinds sit on top of that: facts, preferences, decisions, events, procedures, and rules. Entities and relations are resolved into a per-user graph, so a question can walk two hops instead of hoping the right sentence was nearby.",
	},
	{
		id: "recall",
		title: "Recall with citations",
		body: "Recall is hybrid: keyword search in SQLite FTS5 and vector search in Vectorize, fused, then packed into a token budget with provenance. Chat, HTTP, and MCP all use the same path. Answers cite the memory or document they came from, so an agent can show its work instead of blending it into a guess.",
	},
	{
		id: "agents",
		title: "The same store for every agent",
		body: "Cursor, Claude, and other MCP clients connect over OAuth. They remember, recall, update, and forget without choosing embedding models or writing SQL. Headless clients can use a bearer key. One store, one user, many agents — none of them start from an empty context window.",
	},
	{
		id: "decay",
		title: "Decay, don't drown",
		body: "Memories pick up a retention score from recency, use, and importance. A sweep moves stale rows to dormant, then archived, then forgotten, and drops their vectors. Restore puts an archived memory back. Documents are not deleted with the derived rows, so truth survives cleanup.",
	},
] as const;

export const faqGroups = [
	{
		id: "faq-product",
		title: "Product",
		items: [
			{
				q: "What is Yumeoi?",
				a: "Yumeoi is a continual learning infrastructure for agents. It turns your sources into a living memory store that chat, HTTP, and MCP clients all read and write.",
			},
			{
				q: "What does continual learning mean here?",
				a: "Agents keep a durable store that updates as you ingest, remember, correct, and forget. They do not re-read a giant prompt each session, and they do not freeze a snapshot that never changes.",
			},
			{
				q: "How is this different from a bigger context window?",
				a: "A context window is a bag of recent tokens. Yumeoi extracts atomic memories, types them, links them, cites them, and lets unused ones decay. The agent gets a small, ranked, sourced packet instead of whatever still fit.",
			},
			{
				q: "Who is it for?",
				a: "People who run coding agents, research agents, or personal assistants and are tired of re-explaining preferences, decisions, and history every time a new chat starts.",
			},
		],
	},
	{
		id: "faq-model",
		title: "Model and architecture",
		items: [
			{
				q: "What is a memory versus a document?",
				a: "A document is the original page, note, or file. A memory is a short extracted statement with type, provenance, and a lifecycle. Memories are what agents consume. Documents are what you can open when you want the evidence.",
			},
			{
				q: "Where does my data live?",
				a: "Per user, on Cloudflare: Durable Object SQLite for the store and keyword index, Vectorize for embeddings, R2 for raw documents. Recall is scoped to that user. There is no shared graph across users.",
			},
			{
				q: "How does recall choose what to send?",
				a: "It searches keywords and vectors, merges the lists, applies type and time, optionally reranks, and packs the result to a token budget with citations. Stale, superseded, and forgotten memories stay out of the default set.",
			},
			{
				q: "Can I ask about the past as of a date?",
				a: "Yes. Memories are bitemporal. You can recall what was true at a time, walk a timeline, or ask what changed since a timestamp.",
			},
		],
	},
	{
		id: "faq-agents",
		title: "Agents",
		items: [
			{
				q: "How do I connect Cursor or Claude?",
				a: "Add the MCP URL and complete OAuth in the browser. No API key in that config. Manage connected clients on the Agents page.",
			},
			{
				q: "Do I need an API key?",
				a: "Not for Cursor or Claude over MCP OAuth. Mint a key only for curl, scripts, or other headless clients that send an Authorization bearer token.",
			},
			{
				q: "Can an agent write memories, or only read them?",
				a: "Both. Agents can remember, update, give feedback, and forget. Extracted memories from your sources need confirmation before a hard forget.",
			},
			{
				q: "Will two agents share the same memory?",
				a: "Yes, if they authenticate as the same user. That is the point: one store, many clients, no private silo per chat.",
			},
		],
	},
	{
		id: "faq-trust",
		title: "Trust and company",
		items: [
			{
				q: "Can I delete something?",
				a: "Yes. Forget retires a memory from recall. After a grace period it is hard-deleted. Archived memories can be restored. The source document remains unless you disconnect the source.",
			},
			{
				q: "Who can see my memories?",
				a: "Only clients you authorize for that user. OAuth grants and API keys can be revoked. This build is single-tenant per user — no team sharing yet.",
			},
			{
				q: "What sources are supported today?",
				a: "Notion over OAuth, a demo workspace, and generic markdown ingest. Gmail and Obsidian are planned on the same pipeline.",
			},
			{
				q: "Who is Singularity?",
				a: "Singularity is the company building Yumeoi. The product is the memory infrastructure. The company is the team behind it.",
			},
		],
	},
] as const;
