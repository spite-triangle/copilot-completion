/**
 * Returns the caller's source filename:line from the call stack.
 * skips 1 frame (itself + 1 caller level).
 */
export function srcLoc(skipFrames: number = 0): string {
    const stack = new Error().stack;
    if (!stack) return '?:?';
    const lines = stack.split('\n');
    // lines[0] = "Error", lines[1] = "at srcLoc (...)", lines[2+skip] = actual caller
    const callerIdx = 3 + skipFrames; // +1 for Error, +1 for srcLoc itself, +1 for wrapper, +skip
    const line = lines[callerIdx < lines.length ? callerIdx : lines.length - 1] || '';
    const m = line.match(/(?:at\s+.*?\()?.*?[\\/]([^\\/]+\.ts:\d+)/);
    if (m) return m[1];
    // Fallback: try simpler pattern
    const m2 = line.match(/([^\\/]+\.ts:\d+)/);
    return m2 ? m2[1] : '?:?';
}
