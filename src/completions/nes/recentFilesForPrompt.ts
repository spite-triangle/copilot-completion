import { DocumentId, PromptOptions, IncludeLineNumbersOption, StatelessNextEditDocument, IXtabHistoryEntry, IXtabHistoryEditEntry, RecentFileClippingStrategy } from './stubs/types';
import { LanguageContextResponse, ContextKind } from './stubs/languageContext';
import { StringText } from './stubs/abstractText';
import { OffsetRange } from './stubs/offsetRange';
import { batchArrayElements } from '../../common/arrays';
import { illegalArgument } from '../../common/errors';
import { expandRangeToPageRange } from './promptCrafting';
import { countTokensForLines, toUniquePath } from './promptCraftingUtils';
import { INeighborFileSnippet } from './similarFilesContextService';
import { PromptTags } from './tags';

/**
 * Result of appending neighbor-file snippets, used for telemetry.
 */
export interface AppendNeighborFileSnippetsResult {
    readonly nComputed: number;
    readonly nIncluded: number;
    readonly includedIndices: readonly number[];
}

export function getRecentCodeSnippets(
    activeDoc: StatelessNextEditDocument,
    xtabHistory: readonly IXtabHistoryEntry[],
    langCtx: LanguageContextResponse | undefined,
    computeTokens: (code: string) => number,
    opts: PromptOptions,
    neighborSnippets?: readonly INeighborFileSnippet[],
): { codeSnippets: string; documents: Set<DocumentId>; neighborSnippetsResult: AppendNeighborFileSnippetsResult | undefined } {

    const { includeViewedFiles, nDocuments, clippingStrategy } = opts.recentlyViewedDocuments;

    let recentlyViewedCodeSnippets: RecentCodeSnippet[];

    if (clippingStrategy === RecentFileClippingStrategy.Proportional) {
        const grouped = collectRecentDocumentsGrouped(xtabHistory, activeDoc.id, includeViewedFiles, nDocuments);
        recentlyViewedCodeSnippets = grouped.map(g => historyEntriesToCodeSnippet(g.entries));
    } else {
        const docsBesidesActiveDoc = collectRecentDocuments(xtabHistory, activeDoc.id, includeViewedFiles, nDocuments);
        recentlyViewedCodeSnippets = docsBesidesActiveDoc.map(d => historyEntryToCodeSnippet(d, clippingStrategy));
    }

    const { snippets, docsInPrompt } = buildCodeSnippetsUsingPagedClipping(recentlyViewedCodeSnippets, computeTokens, opts);

    if (langCtx) {
        appendLanguageContextSnippets(langCtx, snippets, opts.languageContext.maxTokens, computeTokens, opts.recentlyViewedDocuments.includeLineNumbers);
    }

    let neighborSnippetsResult: AppendNeighborFileSnippetsResult | undefined;
    if (opts.neighborFiles.enabled && neighborSnippets && neighborSnippets.length > 0) {
        neighborSnippetsResult = appendNeighborFileSnippets(neighborSnippets, snippets, docsInPrompt, opts.neighborFiles.maxTokens, computeTokens, opts.recentlyViewedDocuments.includeLineNumbers);
    }

    return {
        codeSnippets: snippets.join('\n\n'),
        documents: docsInPrompt,
        neighborSnippetsResult,
    };
}

// ============================================================================
// Formatting helpers
// ============================================================================

function formatLinesWithLineNumbers(
    lines: string[],
    includeLineNumbers: IncludeLineNumbersOption,
    startLineOffset: number,
): string[] {
    switch (includeLineNumbers) {
        case IncludeLineNumbersOption.WithSpaceAfter:
            return lines.map((line, idx) => `${startLineOffset + idx}| ${line}`);
        case IncludeLineNumbersOption.WithoutSpace:
            return lines.map((line, idx) => `${startLineOffset + idx}|${line}`);
        case IncludeLineNumbersOption.None:
            return lines;
    }
}

function formatCodeSnippet(
    documentId: DocumentId,
    lines: string[],
    opts: { truncated: boolean; includeLineNumbers: IncludeLineNumbersOption; startLineOffset: number },
): string {
    const filePath = toUniquePath(documentId, undefined);
    const firstLine = opts.truncated
        ? `code_snippet_file_path: ${filePath} (truncated)`
        : `code_snippet_file_path: ${filePath}`;

    const formattedLines = formatLinesWithLineNumbers(lines, opts.includeLineNumbers, opts.startLineOffset);
    const fileContent = formattedLines.join('\n');
    return [PromptTags.RECENT_FILE.start, firstLine, fileContent, PromptTags.RECENT_FILE.end].join('\n');
}

// ============================================================================
// Collecting recent documents from xtab history
// ============================================================================

/**
 * Collect last `nDocuments` unique documents from xtab history, excluding the active document.
 * Returns entries from most to least recent.
 */
function collectRecentDocuments(
    xtabHistory: readonly IXtabHistoryEntry[],
    activeDocId: DocumentId,
    includeViewedFiles: boolean,
    nDocuments: number,
): IXtabHistoryEntry[] {
    const result: IXtabHistoryEntry[] = [];
    const seenDocuments = new Set<DocumentId>();

    for (let i = xtabHistory.length - 1; i >= 0; --i) {
        const entry = xtabHistory[i];

        if (!includeViewedFiles && entry.kind === 'visibleRanges') {
            continue;
        }

        if (entry.docId === activeDocId || seenDocuments.has(entry.docId)) {
            continue;
        }
        result.push(entry);
        seenDocuments.add(entry.docId);
        if (result.length >= nDocuments) {
            break;
        }
    }

    return result;
}

interface GroupedDocumentEntries {
    readonly docId: DocumentId;
    readonly entries: IXtabHistoryEntry[];
}

/**
 * Collect last `nDocuments` unique documents, returning ALL entries per document.
 * Used for Proportional clipping strategy so multiple edit locations within
 * a single document can be used as focal ranges.
 */
function collectRecentDocumentsGrouped(
    xtabHistory: readonly IXtabHistoryEntry[],
    activeDocId: DocumentId,
    includeViewedFiles: boolean,
    nDocuments: number,
): GroupedDocumentEntries[] {
    const docOrder: DocumentId[] = [];
    const docEntries = new Map<DocumentId, IXtabHistoryEntry[]>();

    for (let i = xtabHistory.length - 1; i >= 0; --i) {
        const entry = xtabHistory[i];

        if (!includeViewedFiles && entry.kind === 'visibleRanges') {
            continue;
        }

        if (entry.docId === activeDocId) {
            continue;
        }

        const existing = docEntries.get(entry.docId);
        if (existing) {
            existing.push(entry);
        } else {
            if (docOrder.length >= nDocuments) {
                continue;
            }
            docOrder.push(entry.docId);
            docEntries.set(entry.docId, [entry]);
        }
    }

    return docOrder.map(docId => ({ docId, entries: docEntries.get(docId)! }));
}

// ============================================================================
// Code snippet types and conversion
// ============================================================================

type RecentCodeSnippet = {
    readonly id: DocumentId;
    readonly content: StringText;
    readonly focalRanges?: readonly OffsetRange[];
    readonly editEntryCount?: number;
};

/**
 * Convert a single history entry to a code snippet.
 * Edit entries get focalRanges derived from the edit's replacement ranges
 * in the post-edit document when clipping strategy is not TopToBottom.
 */
function historyEntryToCodeSnippet(d: IXtabHistoryEntry, clippingStrategy: RecentFileClippingStrategy): RecentCodeSnippet {
    if (d.kind === 'edit') {
        const content = new StringText(d.edit.edit.applyOnText(d.edit.base).toString());
        const useFocalRanges = clippingStrategy !== RecentFileClippingStrategy.TopToBottom;
        return {
            id: d.docId,
            content,
            focalRanges: useFocalRanges ? d.edit.edit.getNewRanges() : undefined,
            editEntryCount: 1,
        };
    }
    return {
        id: d.docId,
        content: d.documentContent,
        focalRanges: d.visibleRanges,
    };
}

/**
 * Convert a group of history entries (all for the same document) into a single
 * code snippet. Merges focal ranges from all edit entries so clipping can
 * center on all edit locations.
 */
function historyEntriesToCodeSnippet(entries: IXtabHistoryEntry[]): RecentCodeSnippet {
    const mostRecent = entries[0];
    const content = mostRecent.kind === 'edit'
        ? new StringText(mostRecent.edit.edit.applyOnText(mostRecent.edit.base).toString())
        : mostRecent.documentContent;

    const editEntries: IXtabHistoryEditEntry[] = [];
    for (const entry of entries) {
        if (entry.kind === 'edit') {
            editEntries.push(entry);
        }
    }

    // Transform focal ranges from each edit entry into the most recent content's
    // coordinate space.
    const allFocalRanges: OffsetRange[] = [];
    for (let j = 0; j < editEntries.length; j++) {
        let ranges = editEntries[j].edit.edit.getNewRanges();
        for (let k = j - 1; k >= 0; k--) {
            ranges = ranges.map(r => editEntries[k].edit.edit.applyToOffsetRange(r));
        }
        allFocalRanges.push(...ranges);
    }

    return {
        id: mostRecent.docId,
        content,
        focalRanges: allFocalRanges.length > 0 ? allFocalRanges : undefined,
        editEntryCount: Math.max(editEntries.length, 1),
    };
}

// ============================================================================
// Focal range selection
// ============================================================================

/**
 * Select focal ranges prioritizing the most recent, capping the total line span
 * to prevent wide-scatter edits from consuming the entire budget.
 */
function selectFocalRangesWithinSpanCap(
    focalRanges: readonly OffsetRange[],
    getLineNumber: (offset: number) => number,
    maxSpanLines: number,
): readonly OffsetRange[] {
    if (focalRanges.length <= 1) {
        return focalRanges;
    }

    const selected: OffsetRange[] = [focalRanges[0]];
    let startLine = getLineNumber(focalRanges[0].start);
    let endLine = getLineNumber(Math.max(focalRanges[0].start, focalRanges[0].endExclusive - 1));

    for (let i = 1; i < focalRanges.length; i++) {
        const range = focalRanges[i];
        const rangeStartLine = getLineNumber(range.start);
        const rangeEndLine = getLineNumber(Math.max(range.start, range.endExclusive - 1));
        const candidateStart = Math.min(startLine, rangeStartLine);
        const candidateEnd = Math.max(endLine, rangeEndLine);
        if (candidateEnd - candidateStart > maxSpanLines) {
            break;
        }
        selected.push(range);
        startLine = candidateStart;
        endLine = candidateEnd;
    }

    return selected;
}

// ============================================================================
// Language context snippets
// ============================================================================

function appendLanguageContextSnippets(
    langCtx: LanguageContextResponse,
    snippets: string[],
    tokenBudget: number,
    computeTokens: (code: string) => number,
    includeLineNumbers: IncludeLineNumbersOption,
): void {
    for (const langCtxEntry of langCtx.items) {
        if (langCtxEntry.onTimeout) {
            continue;
        }

        const ctx = langCtxEntry.context;
        if (ctx.kind === ContextKind.Snippet) {
            const langCtxSnippet = ctx.value;
            const potentialBudget = tokenBudget - computeTokens(langCtxSnippet);
            if (potentialBudget < 0) {
                break;
            }
            const documentId = DocumentId.create(ctx.uri.toString());
            snippets.push(formatCodeSnippet(documentId, langCtxSnippet.split(/\r?\n/), {
                truncated: false,
                includeLineNumbers,
                startLineOffset: 0,
            }));
            tokenBudget = potentialBudget;
        }
    }
}

// ============================================================================
// Neighbor file snippets
// ============================================================================

/**
 * Append Completions-style neighbor-file snippets (Jaccard-ranked) to the snippets array.
 * Selects greedily from highest score downward, skipping duplicates and budget overruns.
 * Selected snippets are appended in score-ascending order.
 */
function appendNeighborFileSnippets(
    neighborSnippets: readonly INeighborFileSnippet[],
    snippets: string[],
    docsInPrompt: Set<DocumentId>,
    tokenBudget: number,
    computeTokens: (code: string) => number,
    includeLineNumbers: IncludeLineNumbersOption,
): AppendNeighborFileSnippetsResult {
    const selected: { snippet: INeighborFileSnippet; originalIndex: number }[] = [];
    for (let i = neighborSnippets.length - 1; i >= 0; i--) {
        const neighborSnippet = neighborSnippets[i];
        const documentId = DocumentId.create(neighborSnippet.uri);
        if (docsInPrompt.has(documentId)) {
            continue;
        }
        const potentialBudget = tokenBudget - computeTokens(neighborSnippet.snippet);
        if (potentialBudget < 0) {
            continue;
        }
        selected.push({ snippet: neighborSnippet, originalIndex: i });
        docsInPrompt.add(documentId);
        tokenBudget = potentialBudget;
    }
    // Reverse so highest-scoring snippet is appended last (closest to current file)
    for (let i = selected.length - 1; i >= 0; i--) {
        const neighborSnippet = selected[i].snippet;
        snippets.push(formatCodeSnippet(
            DocumentId.create(neighborSnippet.uri),
            neighborSnippet.snippet.split(/\r?\n/),
            {
                truncated: false,
                includeLineNumbers,
                startLineOffset: neighborSnippet.lineRange.startLine,
            },
        ));
    }
    const includedIndices = selected.map(s => s.originalIndex).sort((a, b) => a - b);
    return {
        nComputed: neighborSnippets.length,
        nIncluded: selected.length,
        includedIndices,
    };
}

// ============================================================================
// Paged clipping
// ============================================================================

/**
 * Clip a file without visible ranges by taking pages from the start until budget is exhausted.
 */
function clipFullDocument(
    document: { id: DocumentId; content: StringText },
    pages: Iterable<string[]>,
    totalLineCount: number,
    tokenBudget: number,
    computeTokens: (s: string) => number,
    includeLineNumbers: IncludeLineNumbersOption,
    result: { snippets: string[]; docsInPrompt: Set<DocumentId> },
): number {
    let allowedBudget = tokenBudget;
    const linesToKeep: string[] = [];

    for (const page of pages) {
        const allowedBudgetLeft = allowedBudget - countTokensForLines(page, computeTokens);
        if (allowedBudgetLeft < 0) {
            break;
        }
        linesToKeep.push(...page);
        allowedBudget = allowedBudgetLeft;
    }

    if (linesToKeep.length > 0) {
        const isTruncated = linesToKeep.length !== totalLineCount;
        result.docsInPrompt.add(document.id);
        result.snippets.push(formatCodeSnippet(document.id, linesToKeep, {
            truncated: isTruncated,
            includeLineNumbers,
            startLineOffset: 0,
        }));
    }

    return allowedBudget;
}

/**
 * Compute the token cost of the focal pages for a file — the minimum tokens
 * needed to include just the pages that contain the focal ranges.
 */
function computeFocalPageCost(
    content: StringText,
    focalRanges: readonly OffsetRange[],
    pageSize: number,
    computeTokens: (s: string) => number,
): number | undefined {
    const contentTransform = content.getTransformer();
    const maxFocalSpanLines = pageSize * 3;
    const capped = selectFocalRangesWithinSpanCap(
        focalRanges,
        offset => contentTransform.getPosition(offset).lineNumber,
        maxFocalSpanLines,
    );

    if (capped.length === 0) {
        return undefined;
    }

    const startOffset = Math.min(...capped.map(r => r.start));
    const endOffset = Math.max(...capped.map(r => r.endExclusive - 1));
    const startLine = contentTransform.getPosition(startOffset).lineNumber;
    const endLine = contentTransform.getPosition(endOffset).lineNumber;

    const lines = content.getLines();
    const firstPageIdx = Math.floor((startLine - 1) / pageSize);
    const lastPageIdxIncl = Math.floor((endLine - 1) / pageSize);

    let cost = 0;
    for (let p = firstPageIdx; p <= lastPageIdxIncl; p++) {
        const start = p * pageSize;
        const end = Math.min(start + pageSize, lines.length);
        cost += countTokensForLines(lines.slice(start, end), computeTokens);
    }
    return cost;
}

/**
 * Clip a file around its focal ranges by expanding pages outward until budget is exhausted.
 */
function clipAroundFocalRanges(
    document: { id: DocumentId; content: StringText; focalRanges: readonly OffsetRange[] },
    pageSize: number,
    totalLineCount: number,
    tokenBudget: number,
    computeTokens: (s: string) => number,
    includeLineNumbers: IncludeLineNumbersOption,
    result: { snippets: string[]; docsInPrompt: Set<DocumentId> },
): number | undefined {
    if (tokenBudget <= 0) {
        return undefined;
    }

    const contentTransform = document.content.getTransformer();
    const maxFocalSpanLines = pageSize * 3;
    const focalRanges = selectFocalRangesWithinSpanCap(
        document.focalRanges,
        offset => contentTransform.getPosition(offset).lineNumber,
        maxFocalSpanLines,
    );

    if (focalRanges.length === 0) {
        return tokenBudget;
    }

    const startOffset = Math.min(...focalRanges.map(range => range.start));
    const endOffset = Math.max(...focalRanges.map(range => range.endExclusive - 1));
    const startPos = contentTransform.getPosition(startOffset);
    const endPos = contentTransform.getPosition(endOffset);

    const { firstPageIdx, lastPageIdxIncl, budgetLeft } = expandRangeToPageRange(
        document.content.getLines(),
        new OffsetRange(startPos.lineNumber - 1, endPos.lineNumber),
        pageSize,
        tokenBudget,
        computeTokens,
        false,
    );

    if (budgetLeft === tokenBudget) {
        return undefined;
    }

    if (budgetLeft < 0) {
        return undefined;
    }

    const startLineOffset = firstPageIdx * pageSize;
    const linesToKeep = document.content.getLines().slice(startLineOffset, (lastPageIdxIncl + 1) * pageSize);
    result.docsInPrompt.add(document.id);
    result.snippets.push(formatCodeSnippet(document.id, linesToKeep, {
        truncated: linesToKeep.length < totalLineCount,
        includeLineNumbers,
        startLineOffset,
    }));
    return budgetLeft;
}

// ============================================================================
// Top-level code snippet building
// ============================================================================

function buildCodeSnippetsUsingPagedClipping(
    recentlyViewedCodeSnippets: RecentCodeSnippet[],
    computeTokens: (s: string) => number,
    opts: PromptOptions,
): { snippets: string[]; docsInPrompt: Set<DocumentId> } {

    const pageSize = opts.pagedClipping?.pageSize;
    if (pageSize === undefined) {
        throw illegalArgument('Page size must be defined');
    }

    const clippingStrategy = opts.recentlyViewedDocuments.clippingStrategy;

    if (clippingStrategy === RecentFileClippingStrategy.Proportional) {
        return buildCodeSnippetsWithProportionalBudget(recentlyViewedCodeSnippets, computeTokens, opts, pageSize);
    }

    return buildCodeSnippetsGreedy(recentlyViewedCodeSnippets, computeTokens, opts, pageSize, clippingStrategy);
}

/**
 * Greedy (most-recent-first) code snippet building.
 */
function buildCodeSnippetsGreedy(
    recentlyViewedCodeSnippets: RecentCodeSnippet[],
    computeTokens: (s: string) => number,
    opts: PromptOptions,
    pageSize: number,
    clippingStrategy: RecentFileClippingStrategy,
): { snippets: string[]; docsInPrompt: Set<DocumentId> } {

    const result: { snippets: string[]; docsInPrompt: Set<DocumentId> } = {
        snippets: [],
        docsInPrompt: new Set<DocumentId>(),
    };

    let maxTokenBudget = opts.recentlyViewedDocuments.maxTokens;
    const includeLineNumbers = opts.recentlyViewedDocuments.includeLineNumbers;

    for (const file of recentlyViewedCodeSnippets) {
        const lines = file.content.getLines();
        const useFocalRanges = clippingStrategy !== RecentFileClippingStrategy.TopToBottom && file.focalRanges !== undefined;

        if (useFocalRanges) {
            const budgetLeft = clipAroundFocalRanges(
                file as { id: DocumentId; content: StringText; focalRanges: readonly OffsetRange[] },
                pageSize, lines.length, maxTokenBudget, computeTokens, includeLineNumbers, result,
            );
            if (budgetLeft === undefined) {
                break;
            }
            maxTokenBudget = budgetLeft;
        } else {
            const pages = batchArrayElements(lines, pageSize);
            maxTokenBudget = clipFullDocument(file, pages, lines.length, maxTokenBudget, computeTokens, includeLineNumbers, result);
        }
    }

    return { snippets: result.snippets.reverse(), docsInPrompt: result.docsInPrompt };
}

/**
 * Two-pass proportional budget allocation:
 * 1. Compute minimum focal page cost for each file and determine which files fit.
 * 2. Distribute remaining budget proportionally by edit-entry-count weight.
 */
function buildCodeSnippetsWithProportionalBudget(
    recentlyViewedCodeSnippets: RecentCodeSnippet[],
    computeTokens: (s: string) => number,
    opts: PromptOptions,
    pageSize: number,
): { snippets: string[]; docsInPrompt: Set<DocumentId> } {

    const result: { snippets: string[]; docsInPrompt: Set<DocumentId> } = {
        snippets: [],
        docsInPrompt: new Set<DocumentId>(),
    };

    const totalBudget = opts.recentlyViewedDocuments.maxTokens;
    const includeLineNumbers = opts.recentlyViewedDocuments.includeLineNumbers;

    if (recentlyViewedCodeSnippets.length === 0) {
        return { snippets: [], docsInPrompt: new Set() };
    }

    // Pass 1: compute minimum focal costs
    const focalCosts = recentlyViewedCodeSnippets.map(file =>
        file.focalRanges !== undefined && file.focalRanges.length > 0
            ? computeFocalPageCost(file.content, file.focalRanges, pageSize, computeTokens) ?? 0
            : 0,
    );

    let includedCount = recentlyViewedCodeSnippets.length;
    let sumFocalCosts = focalCosts.reduce((a, b) => a + b, 0);
    while (includedCount > 0 && sumFocalCosts > totalBudget) {
        includedCount--;
        sumFocalCosts -= focalCosts[includedCount];
    }

    if (includedCount === 0) {
        return { snippets: [], docsInPrompt: new Set() };
    }

    // Pass 2: distribute expansion budget proportionally
    const expansionBudget = totalBudget - sumFocalCosts;
    const weights = recentlyViewedCodeSnippets.slice(0, includedCount).map(f => f.editEntryCount ?? 1);
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    const expansionShares = weights.map(w => Math.floor(expansionBudget * (w / totalWeight)));

    let unspentBudget = 0;

    for (let i = 0; i < includedCount; i++) {
        const file = recentlyViewedCodeSnippets[i];
        const lines = file.content.getLines();
        const effectiveBudget = focalCosts[i] + expansionShares[i] + unspentBudget;

        if (file.focalRanges !== undefined && file.focalRanges.length > 0) {
            const budgetLeft = clipAroundFocalRanges(
                file as { id: DocumentId; content: StringText; focalRanges: readonly OffsetRange[] },
                pageSize, lines.length, effectiveBudget, computeTokens, includeLineNumbers, result,
            );
            unspentBudget = budgetLeft ?? effectiveBudget;
        } else {
            const pages = batchArrayElements(lines, pageSize);
            unspentBudget = clipFullDocument(file, pages, lines.length, effectiveBudget, computeTokens, includeLineNumbers, result);
        }
    }

    return { snippets: result.snippets.reverse(), docsInPrompt: result.docsInPrompt };
}
