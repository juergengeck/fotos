/// <reference path="../../../../../vger/packages/one.core/@OneObjectInterfaces.d.ts" />
/// <reference path="../../../../../vger/packages/one.models/@OneObjectInterfaces.d.ts" />
/// <reference path="../../../../../vger/packages/vger.core/@OneObjectInterfaces.d.ts" />
/// <reference path="../../../../../vger/packages/glue.core/src/recipes/@OneObjectInterfaces.d.ts" />
/// <reference path="../../../../../vger/packages/refinio.api/@OneObjectInterfaces.d.ts" />

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

declare module '@OneObjectInterfaces' {
    export interface OneVersionedObjectInterfaces {
        FotosEntry: import('@refinio/fotos.core').FotosEntry;
        FotosManifest: import('@refinio/fotos.core').FotosManifest;
    }

    export interface OneIdObjectInterfaces {
        FotosEntry: Pick<import('@refinio/fotos.core').FotosEntry, '$type$' | 'contentHash'>;
        FotosManifest: Pick<import('@refinio/fotos.core').FotosManifest, '$type$' | 'id'>;
    }
}

interface GPUDevice {
    destroy(): void;
}

interface GPUAdapter {
    requestDevice(descriptor?: unknown): Promise<GPUDevice>;
}
