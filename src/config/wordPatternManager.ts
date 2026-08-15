export const BUILTIN_WORD_PATTERN = '(?:[\\u4e00-\\u9fff]|[a-zA-Z0-9_]+|\\s+)';

export interface ParsedFragment {
    body: string;
}

/**
 * 剥离 /.../flags 包装（flags 一律丢弃，尤其 g），或按裸 body 处理。
 * 规则：以 / 开头且最后一个 / 之后只含 flag 字符（a-zA-Z）→ 包装形态；
 *      以 / 开头但不满足 → 非法（undefined）；否则整体为裸 body。
 */
export function parseRegexFragment(input: string): ParsedFragment | undefined {
    if (input.length === 0) {
        return undefined;
    }
    if (input.startsWith('/')) {
        const lastSlash = input.lastIndexOf('/');
        if (lastSlash > 0) {
            const flags = input.slice(lastSlash + 1);
            if (/^[a-zA-Z]*$/.test(flags)) {
                const body = input.slice(1, lastSlash);
                if (body.length === 0) {
                    return undefined;
                }
                return { body };
            }
        }
        return undefined;
    }
    return { body: input };
}

/**
 * 返回最终 wordPattern：undefined → 该语言不注册（保持原生）。
 * 用户分支在前、内置兜底在后；统一不带 flags（绝无 g）。
 * 空匹配分支与非法正则 → undefined（拒绝）。
 */
export function buildPattern(input: string | undefined): RegExp | undefined {
    if (input === undefined) {
        return undefined;
    }
    const parsed = parseRegexFragment(input);
    if (parsed === undefined) {
        return undefined;
    }
    const body = parsed.body;
    try {
        if (new RegExp('(?:' + body + ')').test('')) {
            return undefined; // 空匹配拒绝
        }
    } catch {
        return undefined; // 非法正则
    }
    return new RegExp('(?:' + body + '|' + BUILTIN_WORD_PATTERN + ')');
}

/** 语言级键优先，其次 "*"，否则 undefined（不注册）。 */
export function resolveUserFragment(lang: string, config: Record<string, string>): string | undefined {
    if (Object.prototype.hasOwnProperty.call(config, lang)) {
        return config[lang];
    }
    if (Object.prototype.hasOwnProperty.call(config, '*')) {
        return config['*'];
    }
    return undefined;
}
