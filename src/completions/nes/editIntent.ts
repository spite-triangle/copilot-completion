export enum EditIntent {
    NoEdit = 'N',
    Low = 'L',
    Medium = 'M',
    High = 'H',
}

export function parseEditIntent(line: string): EditIntent {
    const trimmed = line.trim();
    if (trimmed === 'N' || trimmed.includes('no_edit')) return EditIntent.NoEdit;
    if (trimmed === 'L' || trimmed.includes('low')) return EditIntent.Low;
    if (trimmed === 'M' || trimmed.includes('medium')) return EditIntent.Medium;
    return EditIntent.High;
}
