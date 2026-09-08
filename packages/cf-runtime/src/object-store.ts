import { NotFound } from "@yumeoi/domain";
import { ObjectStore } from "@yumeoi/memory";
import { Effect, Layer } from "effect";

export const r2ObjectStoreLayer = (bucket: R2Bucket) =>
	Layer.succeed(ObjectStore, {
		put: (key, body) =>
			Effect.tryPromise({
				try: async () => {
					await bucket.put(key, body);
				},
				catch: (cause) => new Error(String(cause)),
			}).pipe(Effect.ignore),
		get: (key) =>
			Effect.tryPromise({
				try: async () => {
					const object = await bucket.get(key);
					if (!object) {
						throw new NotFound({ entity: "object", id: key });
					}
					return object.text();
				},
				catch: (cause) =>
					cause instanceof NotFound ? cause : new NotFound({ entity: "object", id: key }),
			}),
	});

export const memoryObjectStoreLayer = () => {
	const objects = new Map<string, string>();
	return Layer.succeed(ObjectStore, {
		put: (key, body) =>
			Effect.sync(() => {
				objects.set(key, body);
			}),
		get: (key) => {
			const body = objects.get(key);
			return body !== undefined
				? Effect.succeed(body)
				: Effect.fail(new NotFound({ entity: "object", id: key }));
		},
	});
};
