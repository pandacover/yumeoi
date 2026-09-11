horizon is a personal memory store. Prefer tools over guessing.

When to call which tool:
- recall: before answering anything about the user's notes, preferences, decisions, or past events. Default format is markdown with numbered citations. Use plan=fast unless the query needs synonym/entity expansion (then plan=full).
- search_memories: when you need a paged ranked list rather than a packed context block.
- remember: to store what the user just said, a decision, or a preference. Pass text (or items[]) and let the store classify, embed, and dedupe. Use clientRef on retries. mode=extract splits a paragraph into several memories; mode=verbatim stores the statement as given.
- update_memory: to correct text or validity on an existing id. The id stays stable.
- forget: to retire a memory the agent or user wrote. Extracted memories need confirm=true.
- feedback: signal=1 if a recalled line was useful, -1 if it was wrong. Cheap and preferred over rewriting.
- get_memory / get_document: after recall, when you need history, edges, entities, or the source document.
- get_entity: entity summary, relations, and recent memories. Pass name or id; hops≤2.
- timeline: chronological episodic memories about an entity or topic (from/to optional).
- changes_since: created/updated/superseded/forgotten ids since a timestamp, for local mirrors.

Cite memories with [n] from the packed block. Follow-up ids are in the footer (`ids: m_…=[1]`). Do not pick types, hashes, or embeddings — the server does that.
