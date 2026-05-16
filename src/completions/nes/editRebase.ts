export function tryRebase(
    originalDocText: string,
    currentDocText: string,
    originalEdit: string,
): string | undefined {
    if (originalDocText === currentDocText) return originalEdit;
    const origLines = originalDocText.split('\n');
    const currLines = currentDocText.split('\n');
    const commonPrefixLen = _commonPrefixLength(origLines, currLines);
    if (commonPrefixLen === origLines.length) return originalEdit;
    return undefined;
}

function _commonPrefixLength(a: string[], b: string[]): number {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        if (a[i] !== b[i]) return i;
    }
    return len;
}
