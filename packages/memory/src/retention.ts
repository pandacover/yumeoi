import type { Memory, MemoryOrigin, MemoryType } from "@yumeoi/domain";

export const MS_DAY = 86_400_000;
export const HALF_LIFE_MS = {
	episodic: 30 * MS_DAY,
	semantic: 365 * MS_DAY,
	procedural: Number.POSITIVE_INFINITY,
} as const;
export const MAX_ACTIVE_MEMORIES = 20_000;
export const SWEEP_SLICE = 2_000;
export const DORMANT_RETENTION = 0.25;
export const ARCHIVE_RETENTION = 0.1;
export const DORMANT_IDLE_MS = 60 * MS_DAY;
export const ARCHIVE_DORMANT_MS = 90 * MS_DAY;
export const FORGET_GRACE_MS = 30 * MS_DAY;
export const IDLE_CANCEL_MS = 30 * MS_DAY;
export const SWEEP_INTERVAL_SECONDS = 86_400;

export const normalizeMemoryText = (text: string): string =>
	text.toLowerCase().replace(/\s+/g, " ").trim();

export const recencyFactor = (type: MemoryType, ageMs: number): number => {
	const halfLife = HALF_LIFE_MS[type];
	if (!Number.isFinite(halfLife)) {
		return 1;
	}
	if (ageMs <= 0) {
		return 1;
	}
	return 0.5 ** (ageMs / halfLife);
};

export const useFactor = (accessCount: number, feedbackSum: number): number =>
	1 + 0.25 * Math.log(1 + Math.max(0, accessCount)) + 0.15 * feedbackSum;

export const importanceFloor = (origin: MemoryOrigin, hasDerivedChild: boolean): number => {
	if (origin === "agent" || origin === "user") {
		return 0.6;
	}
	if (hasDerivedChild) {
		return 0.3;
	}
	return 0;
};

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export const retentionScore = (input: {
	readonly type: MemoryType;
	readonly importance: number;
	readonly confidence: number;
	readonly now: number;
	readonly lastAccessedAt: number | null;
	readonly observedAt: number | null;
	readonly accessCount: number;
	readonly feedbackSum: number;
	readonly origin: MemoryOrigin;
	readonly hasDerivedChild: boolean;
}): number => {
	const importance = Math.max(
		input.importance,
		importanceFloor(input.origin, input.hasDerivedChild),
	);
	const age = input.now - Math.max(input.lastAccessedAt ?? 0, input.observedAt ?? 0);
	const recency = recencyFactor(input.type, age);
	const use = useFactor(input.accessCount, input.feedbackSum);
	return clamp01(importance ** 0.5 * input.confidence * recency * use);
};

export const isSemanticStale = (memory: Pick<Memory, "type" | "observedAt">, now: number): boolean => {
	if (memory.type !== "semantic") {
		return false;
	}
	const observed = memory.observedAt ?? 0;
	return now - observed >= 2 * HALF_LIFE_MS.semantic;
};

export const shouldDormant = (input: {
	readonly state: Memory["state"];
	readonly retention: number;
	readonly now: number;
	readonly lastAccessedAt: number | null;
	readonly observedAt: number | null;
}): boolean => {
	if (input.state !== "active") {
		return false;
	}
	if (input.retention >= DORMANT_RETENTION) {
		return false;
	}
	const lastTouch = Math.max(input.lastAccessedAt ?? 0, input.observedAt ?? 0);
	return input.now - lastTouch >= DORMANT_IDLE_MS;
};

export const shouldArchive = (input: {
	readonly state: Memory["state"];
	readonly retention: number;
	readonly now: number;
	readonly dormantSince: number | null;
}): boolean => {
	if (input.state !== "dormant") {
		return false;
	}
	if (input.retention >= ARCHIVE_RETENTION) {
		return false;
	}
	if (input.dormantSince == null) {
		return false;
	}
	return input.now - input.dormantSince >= ARCHIVE_DORMANT_MS;
};
