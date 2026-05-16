export interface ParsedEditResult {
    lines: string[];
}

export function handleEditWindowOnly(responseText: string): ParsedEditResult {
    const lines = responseText.split('\n');
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
        lines.pop();
    }
    return { lines };
}
