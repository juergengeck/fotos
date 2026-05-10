// Type declarations for lamejs (no @types package available)
// Note: This is needed because vger.expo type-checks vger.ui source files directly
declare module 'lamejs' {
  export class Mp3Encoder {
    constructor(channels: number, sampleRate: number, kbps: number);
    encodeBuffer(samples: Int16Array): Int8Array;
    flush(): Int8Array;
  }
  export function init(): Promise<void>;
  const _default: {
    Mp3Encoder: typeof Mp3Encoder;
    init?: () => Promise<void>;
  };
  export default _default;
}
