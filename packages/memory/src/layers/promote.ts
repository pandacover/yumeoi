import type { Memory, MemoryKind, MemoryType } from "@yumeoi/domain";
import { SummaryResult, summaryResultJsonSchema } from "@yumeoi/domain";
import { Effect } from "effect";
import { clusterByCosine } from "../cluster.ts";
import { Embeddings } from "../embeddings.ts";
import { resolveName } from "../graph/resolve.ts";
import { Llm } from "../llm.ts";
import { MemoryRepo } from "../memory-repo.ts";
import { remember } from "../remember.ts";

const MS_DAY = 86_400_000;
const EPISODE_CLUSTER_MIN = 3;
const PROCEDURE_CLUSTER_MIN = 3;
const IMPORTANCE_REDUCTION = 0.2;
const PROMOTE_LOOKBACK_MS = 14 * MS_DAY;

type EmbeddedMemory = Memory & { readonly values: ReadonlyArray<number> };

const groupKey = (memory: Memory): string => {
	const entity = memory.entities[0]?.id ?? "ungrounded";
	return `${entity}:${memory.kind}`;
};

const embedMemories = (memories: ReadonlyArray<Memory>) =>
	Effect.gen(function* () {
		if (memories.length === 0) {
			return [] as Array<EmbeddedMemory>;
		}
		const embeddings = yield* Embeddings;
		const vectors = yield* embeddings
			.embed(memories.map((memory) => memory.text))
			.pipe(
				Effect.catchTag("ProviderUnavailable", () =>
					Effect.succeed<ReadonlyArray<ReadonlyArray<number>>>([]),
				),
			);
		return memories.flatMap((memory, index) => {
			const values = vectors[index];
			return values ? [{ ...memory, values }] : [];
		});
	});

const summarizeCluster = (members: ReadonlyArray<Memory>, type: MemoryType, kind: MemoryKind) =>
	Effect.gen(function* () {
		const llm = yield* Llm;
		const evidence = members.map((member) => `- ${member.text}`).join("\n");
		const summary = yield* llm
			.structured({
				job: "summarize",
				schema: SummaryResult,
				schemaName: "summary",
				jsonSchema: summaryResultJsonSchema(),
				system:
					type === "procedural"
						? "Write one reusable procedure or rule from the evidence. Do not concatenate the sources. One or two sentences."
						: "Write one standing fact that the evidence supports. Do not concatenate the sources. One or two sentences, present tense.",
				user: `Type: ${type}\nKind: ${kind}\nEvidence:\n${evidence}`,
			})
			.pipe(
				Effect.orElseSucceed(() => ({
					text: members[0]?.text.slice(0, 400) ?? "Standing fact from related memories.",
				})),
			);
		const text = summary.text.trim();
		return text.length > 0 ? text.slice(0, 400) : "Standing fact from related memories.";
	});

const clusterGroups = (members: ReadonlyArray<EmbeddedMemory>): EmbeddedMemory[][] => {
	const groups = new Map<string, Array<EmbeddedMemory>>();
	for (const member of members) {
		const key = groupKey(member);
		const bucket = groups.get(key) ?? [];
		bucket.push(member);
		groups.set(key, bucket);
	}
	const clusters: EmbeddedMemory[][] = [];
	for (const group of groups.values()) {
		const parts = clusterByCosine(group.map((member) => ({ item: member, values: member.values })));
		clusters.push(...parts);
	}
	return clusters;
};

const promoteCluster = (args: {
	readonly userId: string;
	readonly members: ReadonlyArray<Memory>;
	readonly type: MemoryType;
	readonly kind: MemoryKind;
	readonly importanceReduction: number;
}) =>
	Effect.gen(function* () {
		const text = yield* summarizeCluster(args.members, args.type, args.kind);
		const entities = [
			...new Map(
				args.members.flatMap((member) => member.entities).map((entity) => [entity.id, entity]),
			).values(),
		];
		const outcome = yield* remember({
			userId: args.userId,
			items: [
				{
					text,
					type: args.type,
					kind: args.kind,
					importance: Math.min(
						1,
						args.members.reduce((sum, member) => sum + member.importance, 0) / args.members.length +
							0.1,
					),
					entities: entities.map((entity) => ({ name: entity.name, type: entity.type })),
				},
			],
			mode: "verbatim",
			dedupe: true,
			origin: "derived",
			sourceId: `derived:${args.userId}`,
		});
		const id = outcome.items[0]?.id;
		if (!id) {
			return null;
		}
		const repo = yield* MemoryRepo;
		for (const member of args.members) {
			yield* repo.insertEdge(id, member.id, "derived_from");
			if (args.importanceReduction > 0) {
				yield* repo.updateMemory(member.id, {
					importance: Math.max(0, member.importance - args.importanceReduction),
				});
			}
		}
		return id;
	});

const eligibleEpisodes = (now: number) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const cutoff = now - PROMOTE_LOOKBACK_MS;
		const episodes = yield* repo.listRecentEpisodic(0, 500);
		const old = episodes.filter(
			(memory) => (memory.eventAt ?? memory.observedAt ?? memory.updatedAt ?? 0) <= cutoff,
		);
		const alreadyDerived = new Set(yield* repo.listDerivedParents(old.map((memory) => memory.id)));
		return old.filter((memory) => !alreadyDerived.has(memory.id));
	});

export const promoteEpisodes = (userId: string, now = Date.now()) =>
	Effect.gen(function* () {
		const eligible = yield* eligibleEpisodes(now);
		const embedded = yield* embedMemories(eligible);
		const clusters = clusterGroups(embedded).filter(
			(cluster) => cluster.length >= EPISODE_CLUSTER_MIN,
		);
		const created: string[] = [];
		for (const cluster of clusters) {
			const id = yield* promoteCluster({
				userId,
				members: cluster,
				type: "semantic",
				kind: "fact",
				importanceReduction: IMPORTANCE_REDUCTION,
			});
			if (id) {
				created.push(id);
			}
		}
		return {
			created: created.length,
			ids: created,
			clusters: clusters.length,
		};
	});

export const induceProcedures = (userId: string) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const recent = yield* repo.listRecentMemories(300);
		const candidates = recent.filter(
			(memory) =>
				memory.kind === "rule" ||
				memory.kind === "procedure" ||
				(memory.type === "episodic" && (memory.kind === "task" || memory.kind === "decision")),
		);
		const alreadyDerived = new Set(
			yield* repo.listDerivedParents(candidates.map((memory) => memory.id)),
		);
		const eligible = candidates.filter((memory) => !alreadyDerived.has(memory.id));
		const embedded = yield* embedMemories(eligible);
		const clusters = clusterGroups(embedded).filter(
			(cluster) => cluster.length >= PROCEDURE_CLUSTER_MIN,
		);
		const created: string[] = [];
		for (const cluster of clusters) {
			const id = yield* promoteCluster({
				userId,
				members: cluster,
				type: "procedural",
				kind: "procedure",
				importanceReduction: 0,
			});
			if (id) {
				created.push(id);
			}
		}
		return { created: created.length, ids: created };
	});

export const runLayerJobs = (userId: string, now = Date.now()) =>
	Effect.gen(function* () {
		const promoted = yield* promoteEpisodes(userId, now);
		const procedures = yield* induceProcedures(userId);
		return { promoted, procedures };
	});

export const recordChatEpisode = (userId: string, text: string) =>
	Effect.gen(function* () {
		const lower = text.toLowerCase();
		if (!/\b(prefer|prefers|decided|decision|will|commit|agreed)\b/.test(lower)) {
			return { recorded: false as const };
		}
		yield* remember({
			userId,
			text,
			mode: "verbatim",
			origin: "chat",
			sourceId: `chat:${userId}`,
		});
		return { recorded: true as const };
	});

export const profileLines = (_userId: string, limit = 25) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const memories = yield* repo.listProfileMemories(limit);
		return memories
			.filter((memory) => memory.type === "semantic" && memory.state === "active")
			.map((memory) => `- ${memory.text}`)
			.join("\n");
	});

export const timelineAbout = (input: {
	readonly userId: string;
	readonly about: string;
	readonly from?: number | null;
	readonly to?: number | null;
	readonly limit?: number;
}) =>
	Effect.gen(function* () {
		const now = Date.now();
		const resolved = yield* resolveName(input.about, input.userId, now, { create: false });
		const repo = yield* MemoryRepo;
		return yield* repo.listTimeline({
			entityId: resolved?.id ?? "",
			about: input.about,
			from: input.from ?? null,
			to: input.to ?? null,
			limit: input.limit ?? 20,
		});
	});

export const changesSince = (since: number) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		return yield* repo.listChangesSince(since);
	});
