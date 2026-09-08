import { ProviderUnavailable, RateLimited, Unauthorized } from "@yumeoi/domain";
import { Context, Effect, Layer } from "effect";

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class ConnectorHttp extends Context.Service<
	ConnectorHttp,
	{
		readonly fetch: (
			url: string,
			init?: RequestInit,
		) => Effect.Effect<Response, RateLimited | ProviderUnavailable | Unauthorized>;
	}
>()("@yumeoi/connectors/Http") {}

export const fetchHttpLayer = (fetchImpl: FetchFn = (url, init) => fetch(url, init)) =>
	Layer.succeed(ConnectorHttp, {
		fetch: (url, init) =>
			Effect.gen(function* () {
				const response = yield* Effect.tryPromise({
					try: () => fetchImpl(url, init),
					catch: (cause) => new ProviderUnavailable({ provider: "http", cause }),
				});
				if (response.status === 429) {
					const retryAfter = Number(response.headers.get("retry-after"));
					return yield* Effect.fail(
						new RateLimited({
							provider: "http",
							retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000,
						}),
					);
				}
				if (response.status === 401 || response.status === 403) {
					return yield* Effect.fail(new Unauthorized({ message: `http ${response.status}` }));
				}
				return response;
			}),
	});
