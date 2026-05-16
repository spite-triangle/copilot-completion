export function normalizeIndent(text: string, baseIndent: string): string {
    if (!text.startsWith('\n') && !text.startsWith('\r\n')) return text;
    const lines = text.split('\n');
    return lines.map((line, i) => {
        if (i === 0) return line;
        return baseIndent + line;
    }).join('\n');
}
