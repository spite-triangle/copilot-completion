import { DocumentId } from './stubs/types';
import { Schemas } from './stubs/network';

export function toUniquePath(documentId: DocumentId, workspaceRootPath: string | undefined): string {
    const filePath = documentId.path;
    const workspaceRootPathWithSlash = workspaceRootPath === undefined ? undefined : (workspaceRootPath.endsWith('/') ? workspaceRootPath : workspaceRootPath + '/');

    const updatedFilePath = workspaceRootPathWithSlash !== undefined && filePath.startsWith(workspaceRootPathWithSlash)
        ? filePath.substring(workspaceRootPathWithSlash.length)
        : filePath;

    return documentId.toUri().scheme === Schemas.vscodeNotebookCell ? `${updatedFilePath}#${documentId.fragment}` : updatedFilePath;
}

export function countTokensForLines(page: string[], computeTokens: (s: string) => number): number {
    return page.reduce((sum, line) => sum + computeTokens(line) + 1 /* \n */, 0);
}

/**
 * 将 system + user 消息通过模板渲染为纯文本 prompt。
 *
 * 注意：这是简单的字符串替换。若 system 内容中包含字面量 "{user}"，
 * 或 user 内容中包含字面量 "{system}"，都会被错误替换。
 * 这是尽力而为的简单替换，适用于正常的 ChatML 模板场景。
 */
export function renderCompletionPrompt(
    template: string,
    system: string,
    user: string,
): string {
    return template
        .replace('{system}', system)
        .replace('{user}', user);
}
