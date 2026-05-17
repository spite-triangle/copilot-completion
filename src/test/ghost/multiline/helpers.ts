import * as vscode from 'vscode';
import { MultilineContext } from '../../../completions/ghost/multiline/types';

export function createMockDocument(lines: string | string[]): vscode.TextDocument {
    const content = Array.isArray(lines) ? lines.join('\n') : lines;
    const lineArray = content.split('\n');
    return {
        lineCount: lineArray.length,
        lineAt: (line: number) => ({
            text: lineArray[line] ?? '',
            range: new vscode.Range(line, 0, line, (lineArray[line] ?? '').length),
            lineNumber: line,
            rangeIncludingLineBreak: new vscode.Range(line, 0, line + 1, 0),
            firstNonWhitespaceCharacterIndex: (lineArray[line] ?? '').length - (lineArray[line] ?? '').trimStart().length,
            isEmptyOrWhitespace: (lineArray[line] ?? '').trim().length === 0,
        }),
        offsetAt: (_pos: vscode.Position) => {
            const pos = _pos as vscode.Position;
            let offset = 0;
            for (let i = 0; i < pos.line; i++) { offset += lineArray[i].length + 1; }
            return offset + pos.character;
        },
        positionAt: (offset: number) => {
            let line = 0;
            let remaining = offset;
            while (line < lineArray.length && remaining > lineArray[line].length) {
                remaining -= lineArray[line].length + 1;
                line++;
            }
            return new vscode.Position(line, Math.max(0, remaining));
        },
        getText: (range?: vscode.Range) => {
            if (!range) return content;
            const start = range.start;
            const end = range.end;
            const selectedLines = lineArray.slice(start.line, end.line + 1);
            if (selectedLines.length === 1) {
                return selectedLines[0].substring(start.character, end.character);
            }
            selectedLines[0] = selectedLines[0].substring(start.character);
            selectedLines[selectedLines.length - 1] = selectedLines[selectedLines.length - 1].substring(0, end.character);
            return selectedLines.join('\n');
        },
        uri: vscode.Uri.parse('file:///test.ts'),
        fileName: '/test.ts',
        isUntitled: false,
        languageId: 'typescript',
        version: 1,
        isDirty: false,
        isClosed: false,
        save: () => Promise.resolve(true),
        eol: vscode.EndOfLine.LF,
    } as unknown as vscode.TextDocument;
}

export function createMockContext(overrides: Partial<MultilineContext> & {
    lines?: string[];
    cursorLine?: number;
    cursorChar?: number;
} = {}): MultilineContext {
    const lines = overrides.lines ?? ['function foo() {', '    return 1;', '}'];
    const cursorLine = overrides.cursorLine ?? 0;
    const cursorChar = overrides.cursorChar ?? lines[cursorLine]?.length ?? 0;
    return {
        document: createMockDocument(lines),
        position: new vscode.Position(cursorLine, cursorChar),
        prefix: lines.slice(0, cursorLine + 1).join('\n').substring(0, cursorChar) + '\n',
        suffix: lines.slice(cursorLine + 1).join('\n'),
        languageId: 'typescript',
        isMiddleOfTheLine: false,
        afterAccept: false,
        ...overrides,
    };
}
