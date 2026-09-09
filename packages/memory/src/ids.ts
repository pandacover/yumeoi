const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

const randomBits60 = (): bigint => {
	const bytes = crypto.getRandomValues(new Uint8Array(8));
	let value = 0n;
	for (const byte of bytes) {
		value = (value << 8n) | BigInt(byte);
	}
	return value >> 4n;
};

const encode12 = (value: bigint): string => {
	let remaining = value;
	let out = "";
	for (let i = 0; i < 12; i++) {
		out = `${CROCKFORD[Number(remaining & 31n)]}${out}`;
		remaining >>= 5n;
	}
	return out;
};

export const newShortId = (prefix: "m" | "e" | "r"): string =>
	`${prefix}_${encode12(randomBits60())}`;
