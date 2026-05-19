import { OffsetRange } from './offsetRange';
import { StringText } from './abstractText';
import { StringEdit } from './stringEdit';

// ========================================================================
// PromptingStrategy enum - matches original xtabPromptOptions.PromptingStrategy
// ========================================================================
export enum PromptingStrategy {
    Xtab275 = 'Xtab275',
    Xtab275EditIntent = 'Xtab275EditIntent',
    Xtab275EditIntentShort = 'Xtab275EditIntentShort',
    Xtab275Aggressiveness = 'Xtab275Aggressiveness',
    XtabAggressiveness = 'XtabAggressiveness',
    PatchBased = 'PatchBased',
    PatchBased01 = 'PatchBased01',
    PatchBased02 = 'PatchBased02',
    UnifiedModel = 'UnifiedModel',
    Nes41Miniv3 = 'Nes41Miniv3',
    Codexv21NesUnified = 'Codexv21NesUnified',
    SimplifiedSystemPrompt = 'SimplifiedSystemPrompt',
    CopilotNesXtab = 'CopilotNesXtab',
}

export enum AggressivenessLevel {
    Low = 'low',
    Medium = 'medium',
    High = 'high',
}

export enum IncludeLineNumbersOption {
    WithSpaceAfter = 'WithSpaceAfter',
    WithoutSpace = 'WithoutSpace',
    None = 'None',
}

export enum RecentFileClippingStrategy {
    TopToBottom = 'TopToBottom',
    AroundEditRange = 'AroundEditRange',
    Proportional = 'Proportional',
}

export interface CurrentFileOptions {
    includeCursorTag?: boolean;
    includeLineNumbers: IncludeLineNumbersOption;
    maxTokens: number;
    prioritizeAboveCursor: boolean;
    includeTags?: boolean;
    editingBoundaryMode?: string;
}

export interface LanguageContextOpts {
    maxTokens: number;
    traitPosition: 'before' | 'after';
}

export interface DiffHistoryOptions {
    onlyForDocsInPrompt: boolean;
    maxTokens: number;
    nEntries: number;
    useRelativePaths: boolean;
}

export interface RecentlyViewedDocumentsOpts {
    maxTokens: number;
    nDocuments: number;
    includeViewedFiles: boolean;
    clippingStrategy: RecentFileClippingStrategy;
    includeLineNumbers: IncludeLineNumbersOption;
}

export interface LintOptions {
    tagName: string;
    warnings: LintOptionWarning;
    showCode: LintOptionShowCode;
    maxLints: number;
    maxLineDistance: number;
    nRecentFiles: number;
}

export enum LintOptionWarning {
    NO = 'NO',
    YES = 'YES',
    YES_IF_NO_ERRORS = 'YES_IF_NO_ERRORS',
}

export enum LintOptionShowCode {
    NO = 'NO',
    YES = 'YES',
    YES_WITH_SURROUNDING = 'YES_WITH_SURROUNDING',
}

export interface NeighborFilesOpts {
    enabled: boolean;
    maxTokens: number;
}

export interface PagedClippingOpts {
    pageSize: number;
}

export interface PromptOptions {
    promptingStrategy: PromptingStrategy;
    includePostScript: boolean;
    recentlyViewedDocuments: RecentlyViewedDocumentsOpts;
    currentFile: CurrentFileOptions;
    languageContext: LanguageContextOpts;
    lintOptions?: LintOptions;
    neighborFiles: NeighborFilesOpts;
    pagedClipping: PagedClippingOpts;
    diffHistory: DiffHistoryOptions;
}

// ========================================================================
// StatelessNextEditDocument
// ========================================================================
export class DocumentId {
    static create(uriStr: string): DocumentId {
        return new DocumentId(uriStr);
    }

    constructor(
        public readonly path: string,
        public readonly fragment?: string,
    ) { }

    toUri(): { scheme: string; toString(): string } {
        return {
            scheme: 'file',
            toString: () => this.path,
        };
    }
}

export interface WorkspaceRoot {
    path: string;
}

export interface StatelessNextEditDocument {
    id: DocumentId;
    workspaceRoot?: WorkspaceRoot;
    languageId?: string;
    documentAfterEditsLines?: string[];
}

// ========================================================================
// IXtabHistoryEntry and IXtabHistoryEditEntry
// ========================================================================
export interface IXtabHistoryEditEntry {
    kind: 'edit';
    docId: DocumentId;
    edit: {
        base: StringText;
        edit: StringEdit;
    };
}

export interface IXtabHistoryVisibleRangesEntry {
    kind: 'visibleRanges';
    docId: DocumentId;
    documentContent: StringText;
    visibleRanges: OffsetRange[];
}

export type IXtabHistoryEntry = IXtabHistoryEditEntry | IXtabHistoryVisibleRangesEntry;
