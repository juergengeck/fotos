/// <reference path="../../../../../one/packages/one.core/@OneObjectInterfaces.d.ts" />
/// <reference path="../../../../../one/packages/one.models/@OneObjectInterfaces.d.ts" />
/// <reference path="../../../../../vger/packages/vger.core/@OneObjectInterfaces.d.ts" />
/// <reference path="../../../../../vger/packages/glue.core/src/recipes/@OneObjectInterfaces.d.ts" />
/// <reference path="../../../../../vger/packages/assembly.core/src/types/Assembly.ts" />

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
        FotosEntry: import('../../../../fotos.core/src/recipes/FotosRecipes.js').FotosEntry;
        FotosManifest: import('../../../../fotos.core/src/recipes/FotosRecipes.js').FotosManifest;
        FotosAuthenticityAttestation: import('../../../../fotos.core/src/recipes/FotosRecipes.js').FotosAuthenticityAttestation;
        FotosMediaVariant: import('../../../../fotos.core/src/recipes/FotosMediaRecipes.js').FotosMediaVariant;
        FotosMediaLocator: import('../../../../fotos.core/src/recipes/FotosMediaRecipes.js').FotosMediaLocator;
    }

    export interface OneIdObjectInterfaces {
        FotosEntry: Pick<import('../../../../fotos.core/src/recipes/FotosRecipes.js').FotosEntry, '$type$' | 'contentHash'>;
        FotosManifest: Pick<import('../../../../fotos.core/src/recipes/FotosRecipes.js').FotosManifest, '$type$' | 'id'>;
        FotosAuthenticityAttestation: Pick<import('../../../../fotos.core/src/recipes/FotosRecipes.js').FotosAuthenticityAttestation, '$type$' | 'id'>;
        FotosMediaVariant: Pick<import('../../../../fotos.core/src/recipes/FotosMediaRecipes.js').FotosMediaVariant, '$type$' | 'contentHash'>;
        FotosMediaLocator: Pick<import('../../../../fotos.core/src/recipes/FotosMediaRecipes.js').FotosMediaLocator, '$type$' | 'id'>;
    }
}

interface GPUDevice {
    destroy(): void;
}

interface GPUAdapter {
    requestDevice(descriptor?: unknown): Promise<GPUDevice>;
}
