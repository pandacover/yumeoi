import type { ExtractedMemory, MemoryKind, MemoryType } from "@yumeoi/domain";
import { extractMentions, extractRelations } from "./graph/names.ts";

const classifyKind = (text: string): MemoryKind => {
	const lower = text.toLowerCase();
	if (
		/\b(how to|steps to|when deploying|run `)/.test(lower) ||
		/\bprocedure\b/.test(lower) ||
		/\bwhen [a-z][^.]{8,}/.test(lower)
	) {
		return "procedure";
	}
	if (
		/\b(always|never|must|required to)\b/.test(lower) &&
		(/\b(cite|use|run|prefer|put|merge|delete|return)\b/.test(lower) ||
			/^(always|never|must|required to)\b/.test(lower))
	) {
		return "rule";
	}
	if (/\b(prefer|prefers|likes|favorite|favourite)\b/.test(lower)) {
		return "preference";
	}
	if (/\b(decided|decision|chose|choose|will use|going with|agreed)\b/.test(lower)) {
		return "decision";
	}
	if (/\b(every monday|each week|every day|recurring)\b/.test(lower)) {
		return "task";
	}
	if (/\b(todo|need to|should|must|task)\b/.test(lower)) {
		return "task";
	}
	if (/\b(works with|reports to|manager|teammate|friend of)\b/.test(lower)) {
		return "relationship";
	}
	if (
		/\b(yesterday|tomorrow|this morning|last week|scheduled|meeting)\b/.test(lower) ||
		/\b20\d{2}-\d{2}-\d{2}\b/.test(lower) ||
		/\bon \d/.test(lower) ||
		/\bat \d{1,2}:\d{2}/.test(lower)
	) {
		return "event";
	}
	return "fact";
};

const classifyType = (text: string, kind: MemoryKind): MemoryType => {
	const lower = text.toLowerCase();
	if (kind === "procedure" || kind === "rule") {
		return "procedural";
	}
	if (kind === "task" && /\b(every|each|always|habit)\b/.test(lower)) {
		return "procedural";
	}
	if (kind === "event" || kind === "task") {
		return "episodic";
	}
	if (
		kind === "decision" &&
		/\b(yesterday|today|on \d|agreed|this morning|last week|at the meeting)\b/.test(lower)
	) {
		return "episodic";
	}
	if (/\b(how to|when deploying|steps|always cite|run `)/.test(lower)) {
		return "procedural";
	}
	return "semantic";
};

export const heuristicExtract = (text: string): ReadonlyArray<ExtractedMemory> => {
	const sentences = text
		.split(/(?<=[.!?])\s+/)
		.map((sentence) => sentence.replace(/\s+/g, " ").trim())
		.filter((sentence) => sentence.length > 24);
	const unique = [...new Set(sentences)].slice(0, 16);
	return unique.map((sentence) => {
		const kind = classifyKind(sentence);
		const type = classifyType(sentence, kind);
		const entities = extractMentions(sentence);
		return {
			type,
			kind,
			text: sentence,
			confidence: 0.62,
			importance: type === "semantic" ? 0.7 : 0.5,
			eventAt: null,
			validFrom: null,
			entities,
			relations: extractRelations(sentence, entities),
		};
	});
};

export const heuristicClassify = (text: string): ExtractedMemory =>
	heuristicExtract(text)[0] ?? {
		type: "semantic",
		kind: "fact",
		text: text.slice(0, 180),
		confidence: 0.5,
		importance: 0.5,
		eventAt: null,
		validFrom: null,
		entities: [],
		relations: [],
	};
