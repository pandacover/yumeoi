import { describe, expect, test } from "bun:test";
import { decryptSecret, encryptSecret, signPayload, verifyPayload } from "./secret.ts";

describe("secret helpers", () => {
	test("round-trips AES-GCM tokens", async () => {
		const cipher = await encryptSecret("dev-key", '{"accessToken":"ntn"}');
		expect(cipher).toContain(".");
		expect(await decryptSecret("dev-key", cipher)).toBe('{"accessToken":"ntn"}');
	});

	test("signs and verifies OAuth state", async () => {
		const token = await signPayload("dev-key", { userId: "default", nonce: "abc" });
		const payload = await verifyPayload<{ userId: string; nonce: string }>("dev-key", token);
		expect(payload).toEqual({ userId: "default", nonce: "abc" });
		expect(await verifyPayload("other", token)).toBeNull();
	});
});
