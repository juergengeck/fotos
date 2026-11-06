type ModelStatus = 'unloaded' | 'downloading' | 'loading' | 'ready' | 'error';
type MultimodalEmbeddingModel = 'clip-vit-base-patch32';

const ORT_WASM_PATHS = {
    mjs: '/ort/ort-wasm-simd-threaded.mjs',
    wasm: '/ort/ort-wasm-simd-threaded.wasm',
} as const;

function l2Normalize(values: ArrayLike<number>): number[] {
    let norm = 0;
    for (let index = 0; index < values.length; index++) {
        norm += values[index] * values[index];
    }

    const scale = Math.sqrt(norm);
    if (scale === 0) {
        throw new Error('Cannot normalize a zero-length embedding');
    }

    const normalized = new Array<number>(values.length);
    for (let index = 0; index < values.length; index++) {
        normalized[index] = values[index] / scale;
    }
    return normalized;
}

function extractRows(data: ArrayLike<number>, rows: number, dimensions: number): number[][] {
    if (data.length !== rows * dimensions) {
        throw new Error(`Unexpected embedding shape: ${rows}x${dimensions} from ${data.length} values`);
    }

    const embeddings: number[][] = [];
    for (let row = 0; row < rows; row++) {
        const start = row * dimensions;
        embeddings.push(l2Normalize(Array.from(data).slice(start, start + dimensions)));
    }
    return embeddings;
}

function averageEmbeddings(embeddings: number[][]): number[] {
    if (embeddings.length === 0) {
        throw new Error('Cannot average zero embeddings');
    }

    const dimensions = embeddings[0].length;
    const values = new Float32Array(dimensions);
    for (const embedding of embeddings) {
        if (embedding.length !== dimensions) {
            throw new Error('Cannot average embeddings with different dimensions');
        }
        for (let index = 0; index < dimensions; index++) {
            values[index] += embedding[index];
        }
    }

    for (let index = 0; index < dimensions; index++) {
        values[index] /= embeddings.length;
    }

    return l2Normalize(values);
}

function createQueryPrompts(text: string): string[] {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
        throw new Error('Text embedding requires a non-empty query');
    }

    return Array.from(new Set([
        trimmed,
        `a photo of ${trimmed}`,
        `photo of ${trimmed}`,
    ]));
}

export class BrowserMultimodalEmbeddingProvider {
    private statusValue: ModelStatus = 'unloaded';
    private tokenizer: any = null;
    private processor: any = null;
    private textModel: any = null;
    private visionModel: any = null;
    private rawImage: any = null;
    private loadPromise: Promise<void> | null = null;

    onProgress?: (progress: { stage: 'download' | 'load' | 'warmup'; percent: number }) => void;
    onError?: (error: Error) => void;

    constructor(private readonly selectedModelId: MultimodalEmbeddingModel) {}

    get status(): ModelStatus {
        return this.statusValue;
    }

    get modelId(): MultimodalEmbeddingModel {
        return this.selectedModelId;
    }

    async load(): Promise<void> {
        if (this.statusValue === 'ready') {
            return;
        }
        if (this.loadPromise) {
            return this.loadPromise;
        }

        this.statusValue = 'downloading';
        this.loadPromise = (async () => {
            try {
                const transformers: any = await import('@huggingface/transformers');
                const {
                    env,
                    AutoTokenizer,
                    AutoProcessor,
                    CLIPTextModelWithProjection,
                    CLIPVisionModelWithProjection,
                    RawImage,
                } = transformers;

                env.allowLocalModels = false;
                env.useBrowserCache = true;

                if (env.backends?.onnx?.wasm) {
                    env.backends.onnx.wasm.wasmPaths = ORT_WASM_PATHS;
                    env.backends.onnx.wasm.numThreads = 1;
                }

                const repoId = 'Xenova/clip-vit-base-patch32';
                const modelOptions = { device: 'wasm' as const };
                const [tokenizer, processor, textModel, visionModel] = await Promise.all([
                    AutoTokenizer.from_pretrained(repoId),
                    AutoProcessor.from_pretrained(repoId),
                    CLIPTextModelWithProjection.from_pretrained(repoId, modelOptions),
                    CLIPVisionModelWithProjection.from_pretrained(repoId, modelOptions),
                ]);

                this.tokenizer = tokenizer;
                this.processor = processor;
                this.textModel = textModel;
                this.visionModel = visionModel;
                this.rawImage = RawImage;
                this.statusValue = 'ready';
                this.onProgress?.({ stage: 'load', percent: 100 });
            } catch (error) {
                this.statusValue = 'error';
                const nextError = error instanceof Error ? error : new Error(String(error));
                this.onError?.(nextError);
                throw nextError;
            } finally {
                this.loadPromise = null;
            }
        })();

        return this.loadPromise;
    }

    async unload(): Promise<void> {
        this.tokenizer = null;
        this.processor = null;
        this.textModel = null;
        this.visionModel = null;
        this.rawImage = null;
        this.loadPromise = null;
        this.statusValue = 'unloaded';
    }

    async embedText(text: string): Promise<number[]> {
        await this.load();

        const prompts = createQueryPrompts(text);
        const textInputs = this.tokenizer(prompts, {
            padding: true,
            truncation: true,
        });
        const { text_embeds } = await this.textModel(textInputs);
        const [rows, dimensions] = text_embeds.dims;
        const embeddings = extractRows(text_embeds.data, rows, dimensions);
        return averageEmbeddings(embeddings);
    }

    async embedImage(image: Blob): Promise<number[]> {
        await this.load();

        const rawImage = await this.rawImage.read(image);
        const imageInputs = await this.processor(rawImage);
        const { image_embeds } = await this.visionModel(imageInputs);
        const [rows, dimensions] = image_embeds.dims;
        const embeddings = extractRows(image_embeds.data, rows, dimensions);
        if (embeddings.length !== 1) {
            throw new Error(`Expected exactly one image embedding, received ${embeddings.length}`);
        }
        return embeddings[0];
    }
}
