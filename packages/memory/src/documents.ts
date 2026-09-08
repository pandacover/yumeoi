import type { Document } from "@yumeoi/domain";
import { Effect, Schema } from "effect";
import { MemoryRepo } from "./memory-repo.ts";
import { ObjectStore } from "./object-store.ts";

const storedDocumentBody = Schema.Struct({
	markdown: Schema.String,
	title: Schema.optionalKey(Schema.String),
	url: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const hydrateFromObject = (document: Document, body: string): Document => {
	try {
		const parsed = Schema.decodeUnknownSync(storedDocumentBody)(JSON.parse(body) as unknown);
		return {
			...document,
			markdown: parsed.markdown,
			...(parsed.title ? { title: parsed.title } : {}),
			...(parsed.url !== undefined ? { url: parsed.url } : {}),
		};
	} catch {
		return { ...document, markdown: body };
	}
};

/** Load a document, preferring the R2/object-store payload when `r2Key` is set. */
export const loadDocument = (id: string) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const objects = yield* ObjectStore;
		const document = yield* repo.getDocument(id);
		if (!document.r2Key) {
			return document;
		}
		const body = yield* objects
			.get(document.r2Key)
			.pipe(Effect.catchTag("NotFound", () => Effect.succeed(null)));
		if (body === null) {
			return document;
		}
		return hydrateFromObject(document, body);
	});
