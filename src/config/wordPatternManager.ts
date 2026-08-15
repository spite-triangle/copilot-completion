import * as vscode from 'vscode';
import { ILogService } from '../completions/shared/log/logService';
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
    if (typeof input !== 'string') {
        return undefined;
    }
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
    if (typeof input !== 'string') {
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

export class WordPatternManager {
    private readonly _registrations = new Map<string, vscode.Disposable>();
    private _generation = 0;
    private _disposed = false;
    private readonly _setLanguageConfiguration: (lang: string, conf: { wordPattern: RegExp }) => vscode.Disposable;

    constructor(
        private readonly _log: ILogService,
        setLanguageConfiguration?: (lang: string, conf: { wordPattern: RegExp }) => vscode.Disposable,
    ) {
        this._setLanguageConfiguration = setLanguageConfiguration ?? vscode.languages.setLanguageConfiguration;
    }

    register(): vscode.Disposable {
        void this.applyAll();

        const disposables: vscode.Disposable[] = [
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('cc-completion.wordPatterns')) {
                    void this.applyAll();
                }
            }),
            vscode.extensions.onDidChange(() => {
                // 插件安装/卸载/更新可能注册新语言；尽力而为（无 onDidChangeLanguages 事件）
                void this.applyAll();
            }),
            vscode.workspace.onDidOpenTextDocument(doc => {
                // 惰性补注册：语言已在但插件激活后才打开文档
                if (!this._registrations.has(doc.languageId)) {
                    const fragment = resolveUserFragment(doc.languageId, this._getConfig());
                    const pattern = buildPattern(fragment);
                    if (pattern) {
                        this._applyOne(doc.languageId, pattern);
                    }
                }
            }),
        ];

        return {
            dispose: () => {
                this._disposed = true;
                for (const d of disposables) {
                    d.dispose();
                }
                for (const d of this._registrations.values()) {
                    d.dispose();
                }
                this._registrations.clear();
            },
        };
    }

    private _getConfig(): Record<string, string> {
        return vscode.workspace.getConfiguration('cc-completion')
            .get<Record<string, string>>('wordPatterns', {});
    }

    private _applyOne(lang: string, pattern: RegExp): void {
        try {
            const d = this._setLanguageConfiguration(lang, { wordPattern: pattern });
            this._registrations.get(lang)?.dispose();
            this._registrations.set(lang, d);
        } catch (e) {
            this._log.error(`[WordPattern] setLanguageConfiguration failed for ${lang}: ${String(e)}`);
        }
    }

    private async applyAll(): Promise<void> {
        if (this._disposed) {
            return;
        }
        const generation = ++this._generation;

        let config: Record<string, string>;
        try {
            config = this._getConfig();
        } catch (e) {
            this._log.error(`[WordPattern] failed to read config: ${String(e)}`);
            return;
        }

        let languages: string[];
        try {
            languages = await vscode.languages.getLanguages();
        } catch (e) {
            this._log.error(`[WordPattern] getLanguages failed: ${String(e)}`);
            return;
        }
        if (this._disposed || generation !== this._generation) {
            return; // 过期结果丢弃（竞态防护）；已 dispose 则不再注册
        }

        const next = new Map<string, vscode.Disposable>();
        for (const lang of languages) {
            if (this._disposed) {
                break;
            }
            const fragment = resolveUserFragment(lang, config);
            const pattern = buildPattern(fragment);
            if (pattern) {
                try {
                    next.set(lang, this._setLanguageConfiguration(lang, { wordPattern: pattern }));
                } catch (e) {
                    this._log.error(`[WordPattern] setLanguageConfiguration failed for ${lang}: ${String(e)}`);
                }
            } else if (fragment !== undefined) {
                this._log.warn(`[WordPattern] skipped ${lang}: invalid or empty-matching fragment`);
            }
        }

        // dispose 所有旧注册：已移除配置的语言 → 还原原生；仍配置的语言 → 替换前释放（避免泄漏）
        for (const d of this._registrations.values()) {
            d.dispose();
        }
        this._registrations.clear();
        for (const [lang, d] of next) {
            this._registrations.set(lang, d);
        }
    }
}
