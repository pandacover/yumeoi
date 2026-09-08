const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toB64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

const fromB64 = (value: string): Uint8Array =>
	Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

const importKey = async (secret: string): Promise<CryptoKey> => {
	const hash = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
	return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
};

export const encryptSecret = async (secret: string, plaintext: string): Promise<string> => {
	const key = await importKey(secret);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const cipher = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		encoder.encode(plaintext),
	);
	return `${toB64(iv)}.${toB64(new Uint8Array(cipher))}`;
};

export const decryptSecret = async (secret: string, payload: string): Promise<string> => {
	const [ivPart, dataPart] = payload.split(".");
	if (!ivPart || !dataPart) {
		throw new Error("invalid ciphertext");
	}
	const key = await importKey(secret);
	const plain = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: fromB64(ivPart) },
		key,
		fromB64(dataPart),
	);
	return decoder.decode(plain);
};

export const signPayload = async (
	secret: string,
	payload: unknown,
	ttlMs = 15 * 60_000,
): Promise<string> => {
	const body = JSON.stringify({ payload, exp: Date.now() + ttlMs });
	const key = await crypto.subtle.importKey(
		"raw",
		await crypto.subtle.digest("SHA-256", encoder.encode(secret)),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
	return `${toB64(encoder.encode(body))}.${toB64(new Uint8Array(signature))}`;
};

export const verifyPayload = async <T>(secret: string, token: string): Promise<T | null> => {
	const [bodyPart, sigPart] = token.split(".");
	if (!bodyPart || !sigPart) {
		return null;
	}
	const key = await crypto.subtle.importKey(
		"raw",
		await crypto.subtle.digest("SHA-256", encoder.encode(secret)),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"],
	);
	const bodyBytes = fromB64(bodyPart);
	const ok = await crypto.subtle.verify("HMAC", key, fromB64(sigPart), bodyBytes);
	if (!ok) {
		return null;
	}
	try {
		const parsed = JSON.parse(decoder.decode(bodyBytes)) as { payload: T; exp: number };
		if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) {
			return null;
		}
		return parsed.payload;
	} catch {
		return null;
	}
};

export const tokenEncryptionKey = (env: {
	readonly TOKEN_ENCRYPTION_KEY?: string;
	readonly YUMEOI_API_KEY?: string;
}): string => env.TOKEN_ENCRYPTION_KEY || env.YUMEOI_API_KEY || "yumeoi-dev-token-key";
