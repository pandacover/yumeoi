#!/usr/bin/env bun
/**
 * Live M1 model eval. Prefers OpenRouter; falls back to the OpenAI API.
 * Usage: bun scripts/m1-eval.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	ConsolidateDecision,
	consolidateDecisionJsonSchema,
	ExtractedMemories,
	extractedMemoriesJsonSchema,
	type LlmEffort,
	RerankResult,
	rerankResultJsonSchema,
} from "@yumeoi/domain";
import {
	CONSOLIDATE_SYSTEM,
	type EvalSet,
	EXTRACT_SYSTEM,
	RERANK_SYSTEM,
	scoreConsolidate,
	scoreExtraction,
	scoreRerank,
	summarizeConsolidate,
	summarizeExtraction,
	summarizeRerank,
} from "@yumeoi/memory";
import { Schema } from "effect";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const set = JSON.parse(readFileSync(resolve(root, "docs/eval/m1-set.json"), "utf8")) as EvalSet;

type Candidate = { readonly model: string; readonly effort: LlmEffort };
type Usage = {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly reasoningTokens: number;
	readonly costUsd: number;
	readonly latencyMs: number;
	readonly provider: string;
};

type StructuredCall = {
	readonly parsed: unknown;
	readonly usage: Usage;
};

const EXTRACT_CANDIDATES: Candidate[] = [
	{ model: "gpt-5.6-luna", effort: "none" },
	{ model: "gpt-5.6-luna", effort: "low" },
	{ model: "gpt-5.6-luna", effort: "medium" },
	{ model: "gpt-5.6-luna", effort: "high" },
	{ model: "gpt-5.6-terra", effort: "low" },
];

const CONSOLIDATE_CANDIDATES = EXTRACT_CANDIDATES;
const RERANK_CANDIDATES: Candidate[] = [
	{ model: "gpt-5.6-luna", effort: "none" },
	{ model: "gpt-5.6-luna", effort: "low" },
	{ model: "gpt-5.6-terra", effort: "low" },
];

const CONCURRENCY = 4;
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const mapPool = async <T, R>(
	items: ReadonlyArray<T>,
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
	const results = new Array<R>(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const index = next;
			next += 1;
			const item = items[index];
			if (item === undefined) {
				return;
			}
			results[index] = await fn(item, index);
		}
	});
	await Promise.all(workers);
	return results;
};

const stripSchemaMeta = (schema: Record<string, unknown>): Record<string, unknown> => {
	const { $schema: _schema, $id: _id, ...rest } = schema;
	return rest;
};

const extractedSchema = stripSchemaMeta(extractedMemoriesJsonSchema());
const consolidateSchema = stripSchemaMeta(consolidateDecisionJsonSchema());
const rerankSchema = stripSchemaMeta(rerankResultJsonSchema());

const usageFromBody = (
	body: Record<string, unknown>,
	latencyMs: number,
	provider: string,
): Usage => {
	const usage = (body.usage ?? {}) as Record<string, unknown>;
	const details = (usage.completion_tokens_details ?? {}) as Record<string, unknown>;
	return {
		inputTokens: Number(usage.prompt_tokens ?? 0),
		outputTokens: Number(usage.completion_tokens ?? 0),
		reasoningTokens: Number(details.reasoning_tokens ?? usage.native_tokens_reasoning ?? 0),
		costUsd: Number(usage.cost ?? 0),
		latencyMs,
		provider,
	};
};

const contentFromChat = (body: Record<string, unknown>): string => {
	const choices = body.choices as Array<{ message?: { content?: unknown } }> | undefined;
	const content = choices?.[0]?.message?.content;
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		return content
			.map((part) => (typeof part === "object" && part && "text" in part ? String(part.text) : ""))
			.join("");
	}
	throw new Error("missing message content");
};

const postJson = async (
	url: string,
	headers: Record<string, string>,
	payload: unknown,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown>; raw: string }> => {
	const response = await fetch(url, {
		method: "POST",
		headers,
		body: JSON.stringify(payload),
	});
	const raw = await response.text();
	let parsedBody: Record<string, unknown> = {};
	try {
		parsedBody = JSON.parse(raw) as Record<string, unknown>;
	} catch {
		parsedBody = { error: raw };
	}
	return { ok: response.ok, status: response.status, body: parsedBody, raw };
};

const openRouterModel = (model: string) => (model.includes("/") ? model : `openai/${model}`);

const callOpenRouter = async (
	candidate: Candidate,
	messages: Array<{ role: string; content: string }>,
	schemaName: string,
	schema: Record<string, unknown>,
): Promise<StructuredCall> => {
	const key = process.env.OPENROUTER_API_KEY;
	if (!key) {
		throw new Error("OPENROUTER_API_KEY missing");
	}
	const started = Date.now();
	const result = await postJson(
		"https://openrouter.ai/api/v1/chat/completions",
		{
			Authorization: `Bearer ${key}`,
			"Content-Type": "application/json",
			"HTTP-Referer": "https://yumeoi.dev",
			"X-Title": "yumeoi-m1-eval",
		},
		{
			model: openRouterModel(candidate.model),
			messages,
			response_format: {
				type: "json_schema",
				json_schema: { name: schemaName, strict: true, schema },
			},
			reasoning: { effort: candidate.effort },
			usage: { include: true },
		},
	);
	if (!result.ok) {
		throw new Error(`openrouter ${result.status}: ${result.raw.slice(0, 500)}`);
	}
	return {
		parsed: JSON.parse(contentFromChat(result.body)),
		usage: usageFromBody(result.body, Date.now() - started, "openrouter"),
	};
};

const callOpenAi = async (
	candidate: Candidate,
	messages: Array<{ role: string; content: string }>,
	schemaName: string,
	schema: Record<string, unknown>,
): Promise<StructuredCall> => {
	const key = process.env.OPENAI_API_KEY;
	if (!key) {
		throw new Error("OPENAI_API_KEY missing");
	}
	const started = Date.now();
	const result = await postJson(
		"https://api.openai.com/v1/chat/completions",
		{
			Authorization: `Bearer ${key}`,
			"Content-Type": "application/json",
		},
		{
			model: candidate.model,
			messages,
			response_format: {
				type: "json_schema",
				json_schema: { name: schemaName, strict: true, schema },
			},
			reasoning_effort: candidate.effort,
		},
	);
	if (!result.ok) {
		throw new Error(`openai ${result.status}: ${result.raw.slice(0, 500)}`);
	}
	return {
		parsed: JSON.parse(contentFromChat(result.body)),
		usage: usageFromBody(result.body, Date.now() - started, "openai"),
	};
};

const structured = async (
	candidate: Candidate,
	messages: Array<{ role: string; content: string }>,
	schemaName: string,
	schema: Record<string, unknown>,
): Promise<StructuredCall> => {
	let lastError: unknown;
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
		try {
			if (process.env.OPENROUTER_API_KEY) {
				try {
					return await callOpenRouter(candidate, messages, schemaName, schema);
				} catch (error) {
					lastError = error;
					if (!process.env.OPENAI_API_KEY) {
						throw error;
					}
					console.warn(
						`openrouter failed (${candidate.model}/${candidate.effort} attempt ${attempt + 1}): ${String(error)}`,
					);
					return await callOpenAi(candidate, messages, schemaName, schema);
				}
			}
			return await callOpenAi(candidate, messages, schemaName, schema);
		} catch (error) {
			lastError = error;
			const message = String(error);
			const retryable = /429|500|502|503|504|network|fetch/i.test(message);
			if (!retryable || attempt === MAX_ATTEMPTS - 1) {
				throw error;
			}
			await sleep(1000 * 2 ** attempt);
		}
	}
	throw lastError;
};

const zeroUsage = (): Usage => ({
	inputTokens: 0,
	outputTokens: 0,
	reasoningTokens: 0,
	costUsd: 0,
	latencyMs: 0,
	provider: "none",
});

const addUsage = (left: Usage, right: Usage): Usage => ({
	inputTokens: left.inputTokens + right.inputTokens,
	outputTokens: left.outputTokens + right.outputTokens,
	reasoningTokens: left.reasoningTokens + right.reasoningTokens,
	costUsd: left.costUsd + right.costUsd,
	latencyMs: left.latencyMs + right.latencyMs,
	provider: right.provider || left.provider,
});

const candidateKey = (candidate: Candidate) => `${candidate.model}/${candidate.effort}`;

const pickBest = <T extends { costUsd: number; latencyMs: number }>(
	rows: ReadonlyArray<T>,
	quality: (row: T) => number,
	minDelta = 0.02,
): T => {
	const sorted = [...rows].sort((a, b) => {
		const qualityDelta = quality(b) - quality(a);
		if (Math.abs(qualityDelta) > minDelta) {
			return qualityDelta;
		}
		if (a.costUsd !== b.costUsd) {
			return a.costUsd - b.costUsd;
		}
		return a.latencyMs - b.latencyMs;
	});
	const winner = sorted[0];
	if (!winner) {
		throw new Error("no candidates");
	}
	return winner;
};

const run = async () => {
	if (!process.env.OPENROUTER_API_KEY && !process.env.OPENAI_API_KEY) {
		throw new Error("Need OPENROUTER_API_KEY or OPENAI_API_KEY");
	}

	console.log(
		`eval set: ${set.documents.length} docs, ${set.consolidate.length} consolidate, ${set.rerank.length} rerank`,
	);
	console.log(`provider preference: ${process.env.OPENROUTER_API_KEY ? "openrouter" : "openai"}`);

	const extractRows = [];
	for (const candidate of EXTRACT_CANDIDATES) {
		console.log(`extract ${candidateKey(candidate)}`);
		const scores = await mapPool(set.documents, CONCURRENCY, async (doc) => {
			const call = await structured(
				candidate,
				[
					{ role: "system", content: EXTRACT_SYSTEM },
					{ role: "user", content: `Title: ${doc.title}\n\nChunk:\n${doc.markdown}` },
				],
				"extracted_memories",
				extractedSchema,
			);
			let memories: typeof ExtractedMemories.Type = { memories: [] };
			try {
				memories = Schema.decodeUnknownSync(ExtractedMemories)(call.parsed);
			} catch {
				memories = { memories: [] };
			}
			return { score: scoreExtraction(doc, memories.memories), usage: call.usage };
		});
		const summary = summarizeExtraction(scores.map((row) => row.score));
		const usage = scores.reduce((acc, row) => addUsage(acc, row.usage), zeroUsage());
		extractRows.push({
			job: "extract" as const,
			...candidate,
			...summary,
			...usage,
			perDocument: scores.map((item) => ({
				documentId: item.score.documentId,
				precision: item.score.precision,
				recall: item.score.recall,
				f1: item.score.f1,
				extracted: item.score.extracted,
				inputTokens: item.usage.inputTokens,
				outputTokens: item.usage.outputTokens,
				reasoningTokens: item.usage.reasoningTokens,
				costUsd: item.usage.costUsd,
				latencyMs: item.usage.latencyMs,
				provider: item.usage.provider,
			})),
		});
		console.log(
			`  f1=${summary.f1.toFixed(3)} p=${summary.precision.toFixed(3)} r=${summary.recall.toFixed(3)} tokens in=${usage.inputTokens} out=${usage.outputTokens} reason=${usage.reasoningTokens} cost=$${usage.costUsd.toFixed(4)} latencyMs=${usage.latencyMs}`,
		);
	}

	const consolidateRows = [];
	for (const candidate of CONSOLIDATE_CANDIDATES) {
		console.log(`consolidate ${candidateKey(candidate)}`);
		const scores = await mapPool(set.consolidate, CONCURRENCY, async (item) => {
			const existing =
				item.existing.length === 0
					? "Existing memories: none"
					: `Existing memories:\n${item.existing.map((memory) => `- ${memory.id}: ${memory.text}`).join("\n")}`;
			const call = await structured(
				candidate,
				[
					{ role: "system", content: CONSOLIDATE_SYSTEM },
					{ role: "user", content: `Candidate:\n${item.candidate}\n\n${existing}` },
				],
				"consolidate_decision",
				consolidateSchema,
			);
			let predicted: typeof ConsolidateDecision.Type = { action: "new", targetId: null };
			try {
				predicted = Schema.decodeUnknownSync(ConsolidateDecision)(call.parsed);
			} catch {
				predicted = { action: "new", targetId: null };
			}
			return { score: scoreConsolidate(item, predicted), usage: call.usage };
		});
		const summary = summarizeConsolidate(scores.map((row) => row.score));
		const usage = scores.reduce((acc, row) => addUsage(acc, row.usage), zeroUsage());
		consolidateRows.push({
			job: "consolidate" as const,
			...candidate,
			...summary,
			...usage,
			perCase: scores.map((item) => ({
				caseId: item.score.caseId,
				correct: item.score.correct,
				predictedAction: item.score.predictedAction,
				predictedTargetId: item.score.predictedTargetId,
				inputTokens: item.usage.inputTokens,
				outputTokens: item.usage.outputTokens,
				reasoningTokens: item.usage.reasoningTokens,
				costUsd: item.usage.costUsd,
				latencyMs: item.usage.latencyMs,
				provider: item.usage.provider,
			})),
		});
		console.log(
			`  acc=${summary.accuracy.toFixed(3)} tokens in=${usage.inputTokens} out=${usage.outputTokens} reason=${usage.reasoningTokens} cost=$${usage.costUsd.toFixed(4)} latencyMs=${usage.latencyMs}`,
		);
	}

	const rerankRows = [];
	for (const candidate of RERANK_CANDIDATES) {
		console.log(`rerank ${candidateKey(candidate)}`);
		const scores = await mapPool(set.rerank, CONCURRENCY, async (item) => {
			const call = await structured(
				candidate,
				[
					{ role: "system", content: RERANK_SYSTEM },
					{
						role: "user",
						content: `Query: ${item.query}\n\n${item.candidates.map((memory) => `${memory.id}: ${memory.text}`).join("\n")}`,
					},
				],
				"rerank_result",
				rerankSchema,
			);
			let predicted: typeof RerankResult.Type = { ids: [] };
			try {
				predicted = Schema.decodeUnknownSync(RerankResult)(call.parsed);
			} catch {
				predicted = { ids: [] };
			}
			return { score: scoreRerank(item, predicted.ids), usage: call.usage };
		});
		const summary = summarizeRerank(scores.map((row) => row.score));
		const usage = scores.reduce((acc, row) => addUsage(acc, row.usage), zeroUsage());
		rerankRows.push({
			job: "rerank" as const,
			...candidate,
			...summary,
			...usage,
			perCase: scores.map((item) => ({
				caseId: item.score.caseId,
				ndcg: item.score.ndcg,
				top1: item.score.top1,
				complete: item.score.complete,
				inputTokens: item.usage.inputTokens,
				outputTokens: item.usage.outputTokens,
				reasoningTokens: item.usage.reasoningTokens,
				costUsd: item.usage.costUsd,
				latencyMs: item.usage.latencyMs,
				provider: item.usage.provider,
			})),
		});
		console.log(
			`  ndcg=${summary.ndcg.toFixed(3)} top1=${summary.top1.toFixed(3)} tokens in=${usage.inputTokens} out=${usage.outputTokens} reason=${usage.reasoningTokens} cost=$${usage.costUsd.toFixed(4)} latencyMs=${usage.latencyMs}`,
		);
	}

	const extractWinner = pickBest(extractRows, (row) => row.f1);
	const consolidateSameModel = consolidateRows.filter((row) => row.model === extractWinner.model);
	const consolidatePool = consolidateSameModel.length > 0 ? consolidateSameModel : consolidateRows;
	const consolidateWinner = pickBest(consolidatePool, (row) => row.accuracy);
	const rerankWinner = pickBest(rerankRows, (row) => row.ndcg);

	const report = {
		ranAt: new Date().toISOString(),
		providerPreference: process.env.OPENROUTER_API_KEY ? "openrouter" : "openai",
		pins: {
			chat: { model: "gpt-5.6-luna", effort: "high" },
			extract: { model: extractWinner.model, effort: extractWinner.effort },
			consolidate: { model: consolidateWinner.model, effort: consolidateWinner.effort },
			rerank: { model: rerankWinner.model, effort: rerankWinner.effort },
		},
		extract: extractRows,
		consolidate: consolidateRows,
		rerank: rerankRows,
	};

	const outPath = resolve(root, "docs/eval/m1-results.json");
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
	console.log(`wrote ${outPath}`);
	console.log("pins", JSON.stringify(report.pins, null, 2));
};

await run();
