import { BrowserMultimodalEmbeddingProvider } from '@/lib/BrowserMultimodalEmbeddingProvider';
import {SEMANTIC_EMBEDDING_MODEL_ID} from '@refinio/fotos.core/similarity';

type MultimodalEmbeddingModel = typeof SEMANTIC_EMBEDDING_MODEL_ID;

const MODEL_ID: MultimodalEmbeddingModel = SEMANTIC_EMBEDDING_MODEL_ID;

type WorkerInMessage =
    | { type: 'init' }
    | { type: 'embed-text'; id: string; text: string }
    | { type: 'embed-image'; id: string; imageBlob: Blob };

type WorkerOutMessage =
    | { type: 'ready' }
    | { type: 'result'; id: string; modelId: MultimodalEmbeddingModel; embedding: number[] }
    | { type: 'error'; id?: string; error: string };

let provider: BrowserMultimodalEmbeddingProvider | null = null;

async function getProvider(): Promise<BrowserMultimodalEmbeddingProvider> {
    if (!provider) {
        provider = new BrowserMultimodalEmbeddingProvider(MODEL_ID);
    }

    await provider.load();
    return provider;
}

async function embedText(id: string, text: string) {
    const activeProvider = await getProvider();
    const embedding = await activeProvider.embedText(text);
    const message: WorkerOutMessage = {
        type: 'result',
        id,
        modelId: MODEL_ID,
        embedding,
    };
    self.postMessage(message);
}

async function embedImage(id: string, imageBlob: Blob) {
    const activeProvider = await getProvider();
    const embedding = await activeProvider.embedImage(imageBlob);
    const message: WorkerOutMessage = {
        type: 'result',
        id,
        modelId: MODEL_ID,
        embedding,
    };
    self.postMessage(message);
}

self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
    const message = event.data;
    void (async () => {
        try {
            switch (message.type) {
                case 'init':
                    await getProvider();
                    self.postMessage({ type: 'ready' } satisfies WorkerOutMessage);
                    return;
                case 'embed-text':
                    await embedText(message.id, message.text);
                    return;
                case 'embed-image':
                    await embedImage(message.id, message.imageBlob);
                    return;
            }
        } catch (error) {
            self.postMessage({
                type: 'error',
                id: 'id' in message ? message.id : undefined,
                error: error instanceof Error ? error.message : String(error),
            } satisfies WorkerOutMessage);
        }
    })();
};
