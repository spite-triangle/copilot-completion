interface LineReplacement {
    lineRange: { startLine: number; endLineExclusive: number };
    newLines: string[];
}

interface StatelessNextEditDocument {
    documentAfterEditsLines: string[];
}

/**
 * Filters out NES response lines that overlap with the original document suffix
 * (area_code_suffix and beyond), using Levenshtein-based similarity to handle
 * approximate matches and tolerate empty lines.
 */
export class TrimNESResponseSuffixOverlap {

	constructor(
		public readonly similarityThreshold: number,
		public readonly type: "low" | "high"
	) {

	}


	public calculateOverlap(newLines: readonly string[], suffixLines: string[]): number {
		// Extract non-empty lines with their original indices
		const newLinesMapped = this._mapNonEmpty(newLines);
		const suffixMapped = this._mapNonEmpty(suffixLines);

		if (newLinesMapped.length === 0 || suffixMapped.length === 0) {
			return 0;
		}

		const overlap = this._findOverlapBySimilarity(newLinesMapped, suffixMapped);
		if (overlap === 0) {
			return 0;
		}

		// Map back: the overlap count is in terms of non-empty lines.
		// We need to return the number of ORIGINAL lines to trim.
		const trimUpToOrigIdx = newLinesMapped[overlap - 1].origIdx;
		return trimUpToOrigIdx + 1;
	}

	public trimEditWithDocument(
		edit: LineReplacement,
		doc: StatelessNextEditDocument,
		similarityThreshold: number = 0.5
	): LineReplacement {
		// Get document lines after the edit range (i.e., what follows the code_to_edit area)
		const suffixLines = doc.documentAfterEditsLines.slice(edit.lineRange.endLineExclusive - 1);
		if (suffixLines.length === 0) {
			return edit;
		}

		const overlapCount = this.calculateOverlap(edit.newLines, suffixLines);
		if (overlapCount === 0) {
			return edit;
		}

		return {
			lineRange: edit.lineRange,
			newLines: edit.newLines.slice(0, edit.newLines.length - overlapCount),
		};
	}

	/**
	 * Apply suffix overlap trimming to each edit.
	 * @param similarityThreshold - similarity threshold, default 0.5 (consistent with GhostTextComputer)
	 * @deprecated Use trimEditWithDocument() for better integration with NES provider
	 */
	public filterEdit(resultDocument: StatelessNextEditDocument, edits: readonly LineReplacement[]): readonly LineReplacement[] {
		return edits.map(edit => this.trimEditWithDocument(edit, resultDocument));
	}

	private _mapNonEmpty(lines: readonly string[]): { origIdx: number; text: string }[] {
		const result: { origIdx: number; text: string }[] = [];
		for (let i = 0; i < lines.length; i++) {
			const trimmed = lines[i].trim();
			if (trimmed.length > 0) {
				result.push({ origIdx: i, text: trimmed });
			}
		}
		return result;
	}

	private _levenshteinDistance(s1: string, s2: string): number {
		const len1 = s1.length;
		const len2 = s2.length;
		const matrix: number[][] = [];

		for (let i = 0; i <= len1; i++) {
			matrix[i] = [i];
		}
		for (let j = 0; j <= len2; j++) {
			matrix[0][j] = j;
		}

		for (let i = 1; i <= len1; i++) {
			for (let j = 1; j <= len2; j++) {
				const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
				matrix[i][j] = Math.min(
					matrix[i - 1][j] + 1,
					matrix[i][j - 1] + 1,
					matrix[i - 1][j - 1] + cost
				);
			}
		}
		return matrix[len1][len2];
	};

	private _getLineSimilarity(s1: string, s2: string): number {
		if (s1 === s2) return 1.0;
		const distance = this._levenshteinDistance(s1, s2);
		const maxLen = Math.max(s1.length, s2.length);
		return maxLen === 0 ? 1.0 : 1.0 - distance / maxLen;
	};

	private _findOverlapBySimilarity(
		input: { text: string }[],
		target: { text: string }[]
	): number {
		if (this.type === "high") {
			return this._findOverlapBySimilarityHigh(input, target);
		} else {
			return this._findOverlapBySimilarityLow(input, target);
		}
	}

	private _findOverlapBySimilarityHigh(
		input: { text: string }[],
		target: { text: string }[]
	): number {

		const commonLen = Math.min(input.length, target.length);
		if (commonLen === 0) { return 0; }
		const maxLen = Math.floor(commonLen / Math.min(this.similarityThreshold + 0.05, 1));
		const inputLen = Math.min(input.length, maxLen);
		const targetLen = Math.min(target.length, maxLen);

		// Line similarity table
		const lineSimilarityTable: number[][] = [];
		for (let i = 0; i < inputLen; i++) {
			lineSimilarityTable[i] = [];
			for (let j = 0; j < targetLen; j++) {
				lineSimilarityTable[i][j] = this._getLineSimilarity(input[i].text, target[j].text);
			}
		}


		let maxOverlap = 0;
		let maxSimilarity = 0;

		for (let i = 1; i <= inputLen; i++) {
			const inputStart = inputLen - i;

			const db: { count: number; score: number }[][] = [];
			for (let a = 0; a <= i; a++) {
				db[a] = [];
				for (let b = 0; b <= targetLen; b++) {
					db[a].push({ count: 0, score: 0 });
				}
			}

			for (let a = 1; a <= i; a++) {
				const inputIdx = inputStart + a - 1;
				for (let b = 1; b <= targetLen; b++) {
					const similarityLine = lineSimilarityTable[inputIdx][b - 1];

					if (similarityLine >= 0.8) {
						db[a][b].count = db[a - 1][b - 1].count + 1;
						db[a][b].score = db[a - 1][b - 1].score + similarityLine;
					} else {
						if (db[a][b - 1].count > db[a - 1][b].count) {
							db[a][b].count = db[a][b - 1].count;
							db[a][b].score = db[a][b - 1].score;
						} else {
							db[a][b].count = db[a - 1][b].count;
							db[a][b].score = db[a - 1][b].score;
						}
					}
				}
			}

			for (let j = 1; j <= targetLen; j++) {
				const result = db[i][j];
				const similarity = result.score / (i + j - result.count);
				if (similarity > maxSimilarity) {
					maxOverlap = i;
					maxSimilarity = similarity;
				}
			}
		}

		if (maxSimilarity > this.similarityThreshold) {

			return maxOverlap;
		} else {
			return 0;
		}
	}

	private _findOverlapBySimilarityLow(
		input: { text: string }[],
		target: { text: string }[],
	): number {

		const commonLength = Math.min(input.length, target.length);
		if (commonLength === 0) {
			return 0;
		}

		// Row-level similarity table
		const similarityTable: number[][] = [];
		const start = input.length - commonLength;
		for (let i = 0; i < commonLength; i++) {
			const similarity: number[] = [];
			for (let j = 0; j < i + 1; j++) {
				similarity.push(this._getLineSimilarity(input[start + i].text, target[j].text));
			}
			similarityTable.push(similarity);
		}

		// Multi-line similarity scores
		const scores: number[] = [];
		for (let i = 0; i < commonLength; i++) {
			let sum = 0;
			for (let j = 0; j < commonLength - i; j++) {
				sum += similarityTable[i + j][j];
			}
			scores[i] = sum / (commonLength - i);
		}

		for (let i = 0; i < scores.length; i++) {
			if (scores[i] >= this.similarityThreshold) {
				return commonLength - i;
			}
		}
		return 0;
	}
}
