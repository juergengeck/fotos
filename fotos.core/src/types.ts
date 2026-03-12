/**
 * Face detection and recognition types.
 * Platform-agnostic — no ONNX or image library references.
 */

/** Bounding box in original image coordinates */
export type BBox = [x1: number, y1: number, x2: number, y2: number];

export interface FaceDetection {
    bbox: BBox;
    /** Detection confidence 0-1 */
    score: number;
    /** 5-point landmarks (left eye, right eye, nose, left mouth, right mouth) */
    landmarks: Array<[number, number]>;
}

export interface FaceResult {
    detection: FaceDetection;
    /** 512-dim ArcFace embedding (L2-normalized) */
    embedding: number[];
    /** Relative path to cropped face thumbnail */
    cropPath?: string;
}

export interface FaceAnalysisResult {
    faces: FaceResult[];
}

/** Raw pixel data for processing (CHW format, float32, normalized) */
export interface ImagePixels {
    /** Float32Array in CHW layout [C, H, W] */
    data: Float32Array;
    width: number;
    height: number;
    channels: 3;
}

/** Platform must provide these image operations */
export interface ImageProcessor {
    /** Decode + resize image to exact dimensions, return raw RGB pixels HWC */
    decodeAndResize(path: string, width: number, height: number): Promise<{
        data: Uint8Array;
        origWidth: number;
        origHeight: number;
    }>;

    /** Crop a region from image, resize to target, return raw RGB pixels HWC */
    cropAndResize(
        path: string,
        x: number, y: number, w: number, h: number,
        targetWidth: number, targetHeight: number
    ): Promise<Uint8Array>;

    /** Save a cropped face as JPEG */
    saveFaceCrop(
        path: string,
        x: number, y: number, w: number, h: number,
        outputPath: string,
        size: number
    ): Promise<void>;

    /** Ensure directory exists */
    mkdirp(path: string): Promise<void>;
}

/** Platform must provide ONNX inference */
export interface OnnxSession {
    readonly inputNames: string[];
    readonly outputNames: string[];
    run(feeds: Record<string, OnnxTensor>): Promise<Record<string, OnnxTensor>>;
    release(): Promise<void>;
}

export interface OnnxTensor {
    readonly data: Float32Array | BigInt64Array;
    readonly dims: readonly number[];
}

export interface OnnxRuntime {
    /** Create an inference session from a model file path or buffer */
    createSession(modelPath: string): Promise<OnnxSession>;
    /** Create a float32 tensor */
    createTensor(type: 'float32', data: Float32Array, dims: number[]): OnnxTensor;
}

/** Combined platform dependencies for face analysis */
export interface FacePlatform {
    images: ImageProcessor;
    onnx: OnnxRuntime;
}
