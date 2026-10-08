/**
 * ProviderRegistry — factory that constructs the right EmbeddingProvider
 * based on user settings.
 */
import type { EmbeddingProvider, ProviderContext, ProviderType } from './EmbeddingProvider';
import { OllamaEmbeddingProvider } from './OllamaEmbeddingProvider';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
import { WasmEmbeddingProvider } from './WasmEmbeddingProvider';

export type EmbeddingSettings = {
    providerType: ProviderType;
    // WASM-specific
    wasmModelId?: string;             // default 'Xenova/bge-base-zh'
    wasmDtype?: 'fp32' | 'fp16' | 'q8' | 'q4';  // default 'q8'
    // Ollama-specific
    ollamaUrl?: string;
    ollamaModel?: string;
    // OpenAI-compatible
    openaiUrl?: string;
    openaiModel?: string;
    // Shared (HTTP providers)
    apiKey?: string;
};

export function createProvider(
    settings: EmbeddingSettings,
    context: ProviderContext,
): EmbeddingProvider {
    switch (settings.providerType) {
        case 'wasm': {
            if (!context.workerSource) {
                throw new Error('WASM provider requires context.workerSource');
            }
            if (!context.ortWasmBinary) {
                throw new Error('WASM provider requires context.ortWasmBinary');
            }
            return new WasmEmbeddingProvider(
                {
                    modelId: settings.wasmModelId ?? 'Xenova/bge-base-zh',
                    dtype: settings.wasmDtype ?? 'q8',
                },
                context.workerSource,
                context.ortWasmBinary,
                context.getModelHost,
            );
        }
        case 'ollama': {
            if (!settings.ollamaUrl || !settings.ollamaModel) {
                throw new Error('Ollama provider requires ollamaUrl + ollamaModel');
            }
            if (!context.httpFetch) {
                throw new Error('Ollama provider requires context.httpFetch');
            }
            return new OllamaEmbeddingProvider(
                {
                    url: settings.ollamaUrl,
                    model: settings.ollamaModel,
                    apiKey: settings.apiKey,
                },
                context.httpFetch,
            );
        }
        case 'openai-compatible': {
            if (!settings.openaiUrl || !settings.openaiModel) {
                throw new Error(
                    'OpenAI-compatible provider requires openaiUrl + openaiModel',
                );
            }
            if (!context.httpFetch) {
                throw new Error('OpenAI-compatible provider requires context.httpFetch');
            }
            return new OpenAICompatibleProvider(
                {
                    url: settings.openaiUrl,
                    model: settings.openaiModel,
                    apiKey: settings.apiKey,
                },
                context.httpFetch,
            );
        }
        default: {
            const _exhaustive: never = settings.providerType;
            throw new Error(`unknown provider type: ${String(_exhaustive)}`);
        }
    }
}
