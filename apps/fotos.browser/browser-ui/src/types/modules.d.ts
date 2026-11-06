/// <reference types="@refinio/one.core" />
/// <reference types="@refinio/one.models" />
/// <reference types="@refinio/fotos.core" />
/// <reference types="@vger/vger.core" />
/// <reference types="@refinio/assembly.core" />
/// <reference types="@refinio/source.core" />
/// <reference types="@glueone/glue.core" />

declare module '*?worker&url' {
    const workerUrl: string;
    export default workerUrl;
}

declare module 'react/jsx-runtime.js' {
    export * from 'react/jsx-runtime';
}

declare module 'react/jsx-dev-runtime.js' {
    export * from 'react/jsx-dev-runtime';
}


interface GPUDevice {
    destroy(): void;
}

interface GPUAdapter {
    requestDevice(descriptor?: unknown): Promise<GPUDevice>;
}
