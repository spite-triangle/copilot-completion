import * as vscode from 'vscode';
import { DocumentId, IXtabHistoryEntry } from '../stubs/types';
import { StringText } from '../stubs/abstractText';
import { StringEdit, StringReplacement } from '../stubs/stringEdit';
import { OffsetRange } from '../stubs/offsetRange';

/**
 * Tracks document edits and visible ranges to build xtabHistory
 * for getRecentCodeSnippets and getEditDiffHistory.
 *
 * Aligned with the official NesXtabHistoryTracker:
 *   - Seeds from ALL open documents (not just visible)
 *   - Multiple edit entries per document allowed (idToEntry tracks most-recent for merge)
 *   - Merges consecutive edits within a time + line-proximity window
 *   - Reactive visible-range tracking via editor events
 *   - visibleRanges entries replaced when an edit entry arrives for the same document
 */
export class NesHistoryTracker implements vscode.Disposable {
    private _disposables: vscode.Disposable[] = [];
    private _prevContents = new Map<string, string>();

    /**
     * Most-recent-first history. Can contain multiple entries for the same document.
     * Each entry carries a `remove` callback so it can be deleted from the list
     * when merged or when a visibleRanges entry is superseded by an edit.
     */
    private _history: Array<{ entry: IXtabHistoryEntry; remove: () => void }> = [];

    /**
     * Tracks the most-recent entry per document (edit or visibleRanges).
     * Used for: (a) merge decisions against the previous edit, (b) preventing
     * visibleRanges from being added when an edit already exists.
     */
    private _idToLatest = new Map<string, {
        entry: IXtabHistoryEntry;
        timestamp: number;
        remove: () => void;
    }>();

    private readonly _maxEntries = 50;

    /** Merge consecutive edits within this time window (ms). */
    private readonly _mergeWindowMs = 3_000;
    /** Merge edits whose replaced lines are within this gap. */
    private readonly _mergeLineGap = 2;

    constructor() {
        // Seed _prevContents from ALL open documents (not just visible ones).
        // Fix: previously only seeded from visibleTextEditors, missing background tabs.
        for (const doc of vscode.workspace.textDocuments) {
            if (doc.uri.scheme === 'file' || doc.uri.scheme === 'untitled') {
                this._prevContents.set(doc.uri.toString(), doc.getText());
                this._addOrUpdateVisibleRangeEntry(doc);
            }
        }

        this._disposables.push(
            vscode.workspace.onDidOpenTextDocument(doc => {
                if (doc.uri.scheme === 'file' || doc.uri.scheme === 'untitled') {
                    const key = doc.uri.toString();
                    if (!this._prevContents.has(key)) {
                        this._prevContents.set(key, doc.getText());
                    }
                    this._addOrUpdateVisibleRangeEntry(doc);
                }
            }),

            vscode.workspace.onDidChangeTextDocument(e => this._onDocumentChanged(e)),

            // Reactive visible-range tracking (replaces on-demand snapshot)
            vscode.window.onDidChangeTextEditorVisibleRanges(e => {
                const doc = e.textEditor.document;
                if (doc.uri.scheme === 'file' || doc.uri.scheme === 'untitled') {
                    this._updateVisibleRanges(doc, e.textEditor.visibleRanges);
                }
            }),
        );
    }

    dispose(): void {
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables = [];
    }

    /**
     * Returns the current xtabHistory in most-recent-first order,
     * excluding the active document's visibleRanges entry.
     */
    getHistory(activeDocId: DocumentId): readonly IXtabHistoryEntry[] {
        const activeKey = activeDocId.uri;
        return this._history
            .map(h => h.entry)
            .filter(entry => {
                if (entry.kind === 'visibleRanges' && entry.docId.uri === activeKey) {
                    return false;
                }
                return true;
            });
    }

    // ── document change ────────────────────────────────────────────────

    private _onDocumentChanged(e: vscode.TextDocumentChangeEvent): void {
        const doc = e.document;
        if (doc.uri.scheme !== 'file' && doc.uri.scheme !== 'untitled') return;
        if (e.contentChanges.length === 0) return;

        const key = doc.uri.toString();
        const prevContent = this._prevContents.get(key);
        if (prevContent === undefined) return;

        const base = new StringText(prevContent);
        const docId = DocumentId.create(key);

        const replacements = e.contentChanges.map(change =>
            new StringReplacement(
                new OffsetRange(change.rangeOffset, change.rangeOffset + change.rangeLength),
                change.text,
            ),
        );
        const currentEdit = new StringEdit(replacements);
        const now = Date.now();

        const latest = this._idToLatest.get(key);

        if (latest?.entry.kind === 'edit') {
            const prevEntry = latest.entry;
            const prevRepl = prevEntry.edit.edit.replacements;
            const prevBase = prevEntry.edit.base;

            if (this._shouldMergeEdits(prevRepl, prevBase, base, currentEdit, latest.timestamp, now)) {
                // Merge: replace previous entry with a single clean edit covering
                // the full change from prevBase to the current document state.
                // This avoids accumulating many small replacements (e.g. per-char
                // typing) that produce noisy per-character diff lines.
                latest.remove();
                const fullNewText = doc.getText();
                const mergedEdit: IXtabHistoryEntry = {
                    kind: 'edit',
                    docId,
                    edit: {
                        base: prevBase,
                        edit: new StringEdit([new StringReplacement(
                            new OffsetRange(0, prevBase.toString().length),
                            fullNewText,
                        )]),
                    },
                };
                this._pushEntry(key, mergedEdit, now);
            } else {
                // New logical edit — push as separate entry
                const newEntry: IXtabHistoryEntry = {
                    kind: 'edit',
                    docId,
                    edit: { base, edit: currentEdit },
                };
                this._pushEntry(key, newEntry, now);
            }
        } else {
            // First edit for this doc (or supersedes visibleRanges)
            if (latest?.entry.kind === 'visibleRanges') {
                latest.remove();
            }
            const newEntry: IXtabHistoryEntry = {
                kind: 'edit',
                docId,
                edit: { base, edit: currentEdit },
            };
            this._pushEntry(key, newEntry, now);
        }

        this._prevContents.set(key, doc.getText());
    }

    // ── merge heuristic ────────────────────────────────────────────────

    /**
     * Returns true when `currentEdit` should be merged into the existing edit entry.
     *
     * Merging criteria (Hybrid strategy, aligned with official):
     *   1. Within time window (default 3s — typing coalescence)
     *   2. Edits touch or are within `_mergeLineGap` lines of each other
     */
    private _shouldMergeEdits(
        prevReplacements: StringReplacement[],
        prevBase: StringText,
        currentBase: StringText,
        currentEdit: StringEdit,
        lastTimestamp: number,
        now: number,
    ): boolean {
        if (now - lastTimestamp > this._mergeWindowMs) return false;
        if (prevReplacements.length === 0 || currentEdit.replacements.length === 0) return false;

        const prevTransformer = prevBase.getTransformer();
        const currentTransformer = currentBase.getTransformer();

        for (const pr of prevReplacements) {
            const prevStartLine = prevTransformer.getPosition(pr.range.start).lineNumber;
            const prevEndLine = prevTransformer.getPosition(
                Math.max(pr.range.start, pr.range.endExclusive - 1),
            ).lineNumber;

            for (const cr of currentEdit.replacements) {
                const curStartLine = currentTransformer.getPosition(cr.range.start).lineNumber;
                const curEndLine = currentTransformer.getPosition(
                    Math.max(cr.range.start, cr.range.endExclusive - 1),
                ).lineNumber;

                const distance = Math.min(
                    Math.abs(prevEndLine - curStartLine),
                    Math.abs(prevStartLine - curEndLine),
                    Math.abs(prevStartLine - curStartLine),
                );

                if (distance <= this._mergeLineGap) return true;
            }
        }

        return false;
    }

    // ── visible ranges ──────────────────────────────────────────────────

    private _addOrUpdateVisibleRangeEntry(doc: vscode.TextDocument): void {
        const editor = vscode.window.visibleTextEditors.find(
            e => e.document.uri.toString() === doc.uri.toString(),
        );
        const visibleRanges: readonly vscode.Range[] = editor?.visibleRanges ?? [new vscode.Range(0, 0, doc.lineCount, 0)];
        this._updateVisibleRanges(doc, visibleRanges);
    }

    private _updateVisibleRanges(doc: vscode.TextDocument, ranges: readonly vscode.Range[]): void {
        const key = doc.uri.toString();
        const latest = this._idToLatest.get(key);

        // Never clobber an edit entry with a visibleRanges entry
        if (latest?.entry.kind === 'edit') return;

        const offsetRanges = [...ranges].map(r => {
            const start = doc.offsetAt(r.start);
            const end = doc.offsetAt(r.end);
            return new OffsetRange(start, end);
        });

        const docId = DocumentId.create(key);

        if (latest?.entry.kind === 'visibleRanges') {
            // Update in-place
            latest.remove();
        }

        const newEntry: IXtabHistoryEntry = {
            kind: 'visibleRanges',
            docId,
            documentContent: new StringText(doc.getText()),
            visibleRanges: offsetRanges,
        };
        this._pushEntry(key, newEntry, Date.now());
    }

    // ── push / compact ──────────────────────────────────────────────────

    private _pushEntry(key: string, entry: IXtabHistoryEntry, timestamp: number): void {
        const record = {
            entry,
            remove: () => {
                const idx = this._history.indexOf(record);
                if (idx >= 0) {
                    this._history.splice(idx, 1);
                }
            },
        };
        this._history.unshift(record);
        this._idToLatest.set(key, { entry, timestamp, remove: record.remove });
        this._compact();
    }

    private _compact(): void {
        while (this._history.length > this._maxEntries) {
            const removed = this._history.pop()!;
            const latest = this._idToLatest.get(removed.entry.docId.uri);
            // Only clear idToLatest if it still points to this removed entry
            if (latest?.entry === removed.entry) {
                this._idToLatest.delete(removed.entry.docId.uri);
            }
        }
    }
}
