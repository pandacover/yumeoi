export const cosineSimilarity = (
	left: ReadonlyArray<number>,
	right: ReadonlyArray<number>,
): number => {
	let dot = 0;
	let leftNorm = 0;
	let rightNorm = 0;
	const n = Math.min(left.length, right.length);
	for (let i = 0; i < n; i++) {
		const a = left[i] ?? 0;
		const b = right[i] ?? 0;
		dot += a * b;
		leftNorm += a * a;
		rightNorm += b * b;
	}
	if (leftNorm === 0 || rightNorm === 0) {
		return 0;
	}
	return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
};
