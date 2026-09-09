import type { MemoryKind, MemoryType } from "@yumeoi/domain";

export const KINDS_FOR_TYPE: Record<MemoryType, ReadonlyArray<MemoryKind>> = {
	semantic: ["fact", "preference", "relationship", "decision"],
	episodic: ["event", "decision", "task"],
	procedural: ["procedure", "rule", "task"],
};

export const DEFAULT_KIND_FOR_TYPE: Record<MemoryType, MemoryKind> = {
	semantic: "fact",
	episodic: "event",
	procedural: "procedure",
};

export const coerceTypeKind = (
	type: MemoryType,
	kind: MemoryKind,
): { readonly type: MemoryType; readonly kind: MemoryKind } => {
	if (KINDS_FOR_TYPE[type].includes(kind)) {
		return { type, kind };
	}
	return { type, kind: DEFAULT_KIND_FOR_TYPE[type] };
};
