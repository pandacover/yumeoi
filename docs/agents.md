horizon is a personal memory store. Prefer tools over guessing.

When to call which tool:
- recall: before answering anything about the user's notes, preferences, decisions, or past events. Default format is markdown with numbered citations. Use plan=fast unless the query needs synonym/entity expansion (then plan=full).
- search_memories: when you need a paged ranked list rather than a packed context block.
- remember: to store what the user just said, a decision, or a preference. Pass text (or items[]) and let the store classify, embed, and dedupe. Use clientRef on retries. mode=extract splits a paragraph into several memories; mode=verbatim stores the statement as given.
- update_memory: to correct text or validity on an existing id. The id stays stable.
- forget: to retire a memory the agent or user wrote. Extracted memories need confirm=true.
- feedback: signal=1 if a recalled line was useful, -1 if it was wrong. On -1, pass note (the correction) and/or query (the recall that missed) so the store can rewrite or re-extract the memory text, re-embed it, and keep the same id. Without note or source chunks, -1 only adjusts importance.
- get_memory / get_document: after recall, when you need history, edges, entities, or the source document.
- get_entity: entity summary, relations, and recent memories. Pass name or id; hops≤2.
- timeline: chronological episodic memories about an entity or topic (from/to optional).
- changes_since: created/updated/superseded/forgotten ids since a timestamp, for local mirrors.

Cite memories with [n] from the packed block. Follow-up ids are in the footer (`ids: m_…=[1]`). Do not pick types, hashes, or embeddings — the server does that.

Timestamps: from, to, asOf, since, and recall_context.since are millisecond Unix epochs (not ISO strings). remember/update eventAt, validFrom, and validTo are ISO-8601 strings.

Payload examples:
- recall: {"query":"What does Luv prefer for the domain layer?","format":"markdown","plan":"fast"}
- remember: {"text":"Luv prefers Effect 4 for the yumeoi domain layer.","mode":"verbatim"} or {"items":[{"text":"Luv prefers Effect 4.","clientRef":"note-1"}]}
- feedback: {"id":"m_0123456789ab","signal":1} or {"id":"m_0123456789ab","signal":-1,"note":"Luv prefers Effect 4.","query":"What does Luv prefer?"}
- forget: {"id":"m_0123456789ab"} for agent/user/chat origin; add "confirm":true for extracted memories. Query form: {"query":"oat milk","confirm":true}.
