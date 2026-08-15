// 在插件的 activate() 中
vscode.languages.setLanguageConfiguration('your-language-id', {
    wordPattern: /(?:
        [\u4e00-\u9fff]                    // 单个中文字符
        | [a-zA-Z0-9_]+                     // 或英文单词
        | \s+                               // 或空白
    )/g
});

如果你的插件想控制中文的 accept word 行为，应该用 vscode.languages.setLanguageConfiguration 来设置 wordPattern：


但有一个重要限制：setLanguageConfiguration 是按语言全局生效的，它会同时影响双击选词、Ctrl+Right 光标移动等所有依赖 wordPattern 的功能，而不仅仅是 ghost text 的 accept word。你无法做到"只在 inline completion accept word 时使用自定义分词规则"。

总结

VS Code 插件自定义 wordPattern 支持中文的完整方案
有 两种方式，但关键问题是：acceptNextWord（ghost 补全的 accept word）只使用 wordPattern，不使用 wordSegmenterLocales。

方式一：vscode.languages.setLanguageConfiguration（API 方式）
在插件 activate() 中调用：


关键点是在 wordPattern 中加入 [\u4e00-\u9fff] 作为单独的匹配分支，这样 acceptNextWord 中的 text.match(wordRegExp) 每次只匹配一个中文字符。

验证逻辑（extHostLanguageFeatures.ts:3008）：


正则不能匹配空字符串，上面的模式不会。