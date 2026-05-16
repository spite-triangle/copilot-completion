import { createServiceIdentifier } from '../../../di/services';
import { LLMRequest, LLMResponse } from './llmRequest';
import { SupportedEndpoint } from '../../../config/nesConfig';

export const ILLMAdapterManager = createServiceIdentifier<ILLMAdapterManager>('ILLMAdapterManager');

export interface ILLMAdapter {
    send(request: LLMRequest): Promise<LLMResponse>;
}

export interface ILLMAdapterManager {
    readonly _serviceBrand: undefined;
    register(endpoint: SupportedEndpoint | '/v1/completions', adapter: ILLMAdapter): void;
    getAdapter(endpoint: SupportedEndpoint | '/v1/completions'): ILLMAdapter;
}

export class LLMAdapterManager implements ILLMAdapterManager {
    readonly _serviceBrand: undefined;
    private readonly _adapters = new Map<string, ILLMAdapter>();

    register(endpoint: string, adapter: ILLMAdapter): void {
        this._adapters.set(endpoint, adapter);
    }

    getAdapter(endpoint: string): ILLMAdapter {
        const adapter = this._adapters.get(endpoint);
        if (!adapter) {
            throw new Error(`No adapter registered for endpoint: ${endpoint}`);
        }
        return adapter;
    }
}
