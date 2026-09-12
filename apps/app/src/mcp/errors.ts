import { hintForFieldIssues, mapToolFailure } from "@yumeoi/domain";
import { z } from "zod";

export const toolError = (error: string, hint: string) => ({
	isError: true as const,
	content: [{ type: "text" as const, text: JSON.stringify({ error, hint }) }],
});

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

export const asError = (caught: unknown) => {
	if (isZodError(caught)) {
		return toolError(
			"invalid_input",
			hintForFieldIssues(
				caught.issues.map((issue) => ({
					path: issue.path,
					message: issue.message,
					code: issue.code,
				})),
			),
		);
	}
	const mapped = mapToolFailure(caught);
	return toolError(mapped.error, mapped.hint);
};

export const jsonText = (value: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export const textResult = (text: string) => ({
	content: [{ type: "text" as const, text }],
});

export const runTool = async <S extends z.ZodType, R>(
	schema: S,
	raw: unknown,
	run: (input: z.infer<S>) => Promise<R>,
): Promise<R | ReturnType<typeof asError>> => {
	const parsed = schema.safeParse(raw ?? {});
	if (!parsed.success) {
		return asError(parsed.error);
	}
	try {
		return await run(parsed.data);
	} catch (caught) {
		return asError(caught);
	}
};
