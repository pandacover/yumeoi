import { Context, Effect, Layer } from "effect";

export class Clock extends Context.Service<
	Clock,
	{
		readonly now: Effect.Effect<number>;
	}
>()("@yumeoi/memory/Clock") {}

export const systemClockLayer = Layer.succeed(Clock, {
	now: Effect.sync(() => Date.now()),
});

export const mutableClockLayer = (box: { now: number }) =>
	Layer.succeed(Clock, {
		now: Effect.sync(() => box.now),
	});

export const nowMillis = Effect.gen(function* () {
	const optional = yield* Effect.serviceOption(Clock);
	if (optional._tag === "Some") {
		return yield* optional.value.now;
	}
	return Date.now();
});
