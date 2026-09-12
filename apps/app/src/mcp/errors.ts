import {
	formatToolErrorText,
	hintForFieldIssues,
	mapToolFailure,
	retryWithForTool,
} from "@yumeoi/domain";
import { z } from "zod";
import { parseHorizonInput } from "./schemas.ts";

const formatError = (
	error: string,
	hint: string,
	context: { readonly tool: string; readonly input?: unknown },
) => {
	const retry_with = retryWithForTool(context.tool, context.input ?? {}, { error, hint });
	return {
		isError: true as const,
		content: [
			{
				type: "text" as const,
				text: formatToolErrorText({ tool: context.tool, error, hint, retry_with }),
			},
		],
	};
};

export const toolError = (
	error: string,
	hint: string,
	context: { readonly tool: string; readonly input?: unknown } = { tool: "tool" },
) => formatError(error, hint, context);

const isZodError = (caught: unknown): caught is z.ZodError => {
	if (caught instanceof z.ZodError) {
		return true;
	}
	if (!caught || typeof caught !== "object") {
		return false;
	}
	return (
		"name" in caught &&
		caught.name === "ZodError" &&
		"issues" in caught &&
		Array.isArray(caught.issues)
	);
};

export const asError = (
	caught: unknown,
	context: { readonly tool: string; readonly input?: unknown } = { tool: "tool" },
) => {
	if (isZodError(caught)) {
		return formatError(
			"invalid_input",
			hintForFieldIssues(
				caught.issues.map((issue) => ({
					path: issue.path,
					message: issue.message,
					code: issue.code,
				})),
			),
			context,
		);
	}
	const mapped = mapToolFailure(caught);
	return formatError(mapped.error, mapped.hint, context);
};

export const jsonText = (value: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export const textResult = (text: string) => ({
	content: [{ type: "text" as const, text }],
});

export const runTool = async <S extends z.ZodType, R>(
	tool: string,
	schema: S,
	raw: unknown,
	run: (input: z.infer<S>) => Promise<R>,
): Promise<R | ReturnType<typeof asError>> => {
	const { prepared, parsed } = parseHorizonInput(schema, raw);
	if (!parsed.success) {
		return asError(parsed.error, { tool, input: prepared });
	}
	try {
		return await run(parsed.data);
	} catch (caught) {
		return asError(caught, { tool, input: parsed.data });
	}
};
