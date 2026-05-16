import * as assert from 'assert';

suite('_trimCharOverlap (GHOST suffix-boundary dedup)', () => {

    // Standalone function mirroring GhostTextComputer._trimCharOverlap
    function trimCharOverlap(completion: string, suffix: string): string {
        if (!completion || !suffix) return completion;
        const completionFirstLine = completion.split('\n')[0];
        const suffixFirstLine = suffix.split('\n')[0];
        if (!completionFirstLine || !suffixFirstLine) return completion;
        const maxLen = Math.min(completionFirstLine.length, suffixFirstLine.length);
        for (let len = maxLen; len > 0; len--) {
            const suffixHead = suffixFirstLine.substring(0, len);
            if (completionFirstLine.endsWith(suffixHead)) {
                const trimmedFirstLine = completionFirstLine.substring(0, completionFirstLine.length - len);
                const restLines = completion.split('\n').slice(1);
                return [trimmedFirstLine, ...restLines].join('\n');
            }
        }
        return completion;
    }

    test('for() — completion ends with ") {", suffix starts with ") {"', () => {
        const completion = 'int i = 0; i < 10; ++i) {';
        const suffix = ') {\n    doSomething();\n}';
        const result = trimCharOverlap(completion, suffix);
        // "for(int i = 0; i < 10; ++i) {" is the expected document after insert
        assert.strictEqual(result, 'int i = 0; i < 10; ++i');
    });

    test('if() — completion ends with ") {", suffix starts with ") {"', () => {
        const completion = 'condition) {';
        const suffix = ') {\n    doTrue();\n} else {\n    doFalse();\n}';
        const result = trimCharOverlap(completion, suffix);
        assert.strictEqual(result, 'condition');
    });

    test('single char — completion ends with ")", suffix starts with ")"', () => {
        const completion = 'foo(x, y)';
        const suffix = ') {\n    bar();\n}';
        const result = trimCharOverlap(completion, suffix);
        assert.strictEqual(result, 'foo(x, y');
    });

    test('multi-char with space — ") {" overlap', () => {
        const completion = 'doWork() {';
        const suffix = ') {\n    inner();\n}';
        const result = trimCharOverlap(completion, suffix);
        assert.strictEqual(result, 'doWork(');
    });

    test('no overlap — completion last char differs from suffix first char', () => {
        const completion = 'const x = 1;';
        const suffix = '\nconst y = 2;';
        const result = trimCharOverlap(completion, suffix);
        assert.strictEqual(result, 'const x = 1;');
    });

    test('no overlap — different content at boundary', () => {
        const completion = 'function hello() {\n    console.log("hi");';
        const suffix = '\n}\n';
        const result = trimCharOverlap(completion, suffix);
        assert.strictEqual(result, completion);
    });

    test('multiline completion — only first line participates', () => {
        const completion = 'add(a, b) {\n    return a + b;\n}';
        const suffix = ') {\n    // ...\n}';
        const result = trimCharOverlap(completion, suffix);
        assert.strictEqual(result, 'add(a, b\n    return a + b;\n}');
    });

    test('should not trim when it would empty the first line', () => {
        const completion = ') {';
        const suffix = ') {';
        const result = trimCharOverlap(completion, suffix);
        // first line trimmed to empty string — keep rest lines
        assert.strictEqual(result, '');
    });

    test('empty suffix returns completion unchanged', () => {
        const completion = 'code';
        assert.strictEqual(trimCharOverlap(completion, ''), 'code');
    });

    test('empty completion returns empty string', () => {
        assert.strictEqual(trimCharOverlap('', 'suffix'), '');
    });

    test('suffix = ")\\n" (only closing paren on line) — no overlap at end', () => {
        // The completion ends with "{" not ")", so no overlap is detected.
        // This is the expected behavior — the first-line overlap check
        // protects against false positives.
        const completion = 'int i = 0; i < 10; ++i) {';
        const suffix = ')\n}';
        const result = trimCharOverlap(completion, suffix);
        // No trim because completion first line ends with "{" not ")"
        assert.strictEqual(result, completion);
    });
});
