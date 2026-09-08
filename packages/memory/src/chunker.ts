const TARGET_CHARS = 2000; // ~500 tokens at ~4 chars/token
const OVERLAP_RATIO = 0.15;

export type ChunkSlice = {
	readonly text: string;
	readonly byteStart: number;
	readonly byteEnd: number;
};

const encoder = new TextEncoder();

const toByte = (markdown: string, charIndex: number): number =>
	encoder.encode(markdown.slice(0, charIndex)).length;

const splitAt = (markdown: string, pattern: RegExp): Array<{ start: number; end: number }> => {
	const ranges: Array<{ start: number; end: number }> = [];
	let last = 0;
	for (const match of markdown.matchAll(pattern)) {
		const index = match.index ?? 0;
		if (index > last) {
			ranges.push({ start: last, end: index });
		}
		last = index;
	}
	if (last < markdown.length) {
		ranges.push({ start: last, end: markdown.length });
	}
	return ranges.filter((range) => markdown.slice(range.start, range.end).trim().length > 0);
};

const windows = (markdown: string, start: number, end: number): ChunkSlice[] => {
	const length = end - start;
	if (length <= TARGET_CHARS) {
		const text = markdown.slice(start, end);
		return [{ text, byteStart: toByte(markdown, start), byteEnd: toByte(markdown, end) }];
	}
	const overlap = Math.floor(TARGET_CHARS * OVERLAP_RATIO);
	const slices: ChunkSlice[] = [];
	let offset = start;
	while (offset < end) {
		const sliceEnd = Math.min(end, offset + TARGET_CHARS);
		const text = markdown.slice(offset, sliceEnd);
		slices.push({
			text,
			byteStart: toByte(markdown, offset),
			byteEnd: toByte(markdown, sliceEnd),
		});
		if (sliceEnd >= end) {
			break;
		}
		offset = Math.max(sliceEnd - overlap, offset + 1);
	}
	return slices;
};

/**
 * Heading-aware chunker: split on markdown headings, then window long sections
 * with ~15% overlap. Byte ranges are UTF-8 offsets into the original document.
 */
export const chunkMarkdown = (markdown: string): ReadonlyArray<ChunkSlice> => {
	if (markdown.trim().length === 0) {
		return [];
	}
	const headingRanges = splitAt(markdown, /^#{1,6} /gm);
	const sections = headingRanges.length > 0 ? headingRanges : [{ start: 0, end: markdown.length }];
	const chunks: ChunkSlice[] = [];
	for (const section of sections) {
		const paragraphRanges = splitAt(markdown.slice(section.start, section.end), /\n{2,}/g).map(
			(range) => ({
				start: section.start + range.start,
				end: section.start + range.end,
			}),
		);
		const units = paragraphRanges.length > 0 ? paragraphRanges : [section];
		for (const unit of units) {
			chunks.push(...windows(markdown, unit.start, unit.end));
		}
	}
	return chunks.filter((chunk) => chunk.text.trim().length > 0);
};
