export interface RequestContext {
    prefix: string;
    suffix: string;
    languageId: string;
    ourRequestId: string;
    maxTokens: number;
    temperature: number;
    stop: string[];
    prompt: string;
}
