import type {Person} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {FotosMediaVariant} from './recipes/FotosMediaRecipes.js';
import {FACE_DETECTION_MODEL_ID, FACE_EMBEDDING_MODEL_ID, SEMANTIC_EMBEDDING_MODEL_ID} from './similarity.js';

export const FOTOS_CAPABILITY_VERSION = 1;
export const FOTOS_LIBRARY = 'fotos.library';
export const FOTOS_ENRICHMENT = 'fotos.enrichment';
export const FOTOS_SHARING = 'fotos.sharing';

export const FOTOS_CAPABILITY_METHODS = {
    [FOTOS_LIBRARY]: ['browse', 'resolveOriginal'],
    [FOTOS_ENRICHMENT]: ['enrich'],
    [FOTOS_SHARING]: ['shareCollection'],
} as const;

export const FOTOS_ENRICHMENT_MODELS = [
    FACE_DETECTION_MODEL_ID, FACE_EMBEDDING_MODEL_ID, SEMANTIC_EMBEDDING_MODEL_ID,
] as const;

export type FotosCapability = keyof typeof FOTOS_CAPABILITY_METHODS;
export type FotosEnrichmentModel = typeof FOTOS_ENRICHMENT_MODELS[number];

export interface FotosCapabilityAdvertisement {
    version: typeof FOTOS_CAPABILITY_VERSION;
    methods: Partial<{[Role in FotosCapability]: readonly typeof FOTOS_CAPABILITY_METHODS[Role][number][]}>;
    enrichmentModels?: readonly FotosEnrichmentModel[];
}

export interface FotosSupplierBinding {
    capability: FotosCapability;
    personId: SHA256IdHash<Person>;
    deviceId: string;
}

export interface FotosEnrichmentRequest {
    contentHash: string;
    original: SHA256Hash<FotosMediaVariant>;
    models: readonly FotosEnrichmentModel[];
}

export interface FotosEnrichmentResult {
    contentHash: string;
    variants: readonly SHA256Hash<FotosMediaVariant>[];
}

/** Runtime discovery offers only capabilities with a complete, supported method contract. */
export function fotosSupplierRoles(advertisement: unknown): FotosCapability[] {
    if (advertisement === null || typeof advertisement !== 'object') return [];
    const candidate = advertisement as Partial<FotosCapabilityAdvertisement>;
    if (candidate.version !== FOTOS_CAPABILITY_VERSION || !candidate.methods || typeof candidate.methods !== 'object') return [];
    return (Object.keys(FOTOS_CAPABILITY_METHODS) as FotosCapability[]).filter(role => {
        const methods: readonly string[] | undefined = candidate.methods?.[role];
        if (!Array.isArray(methods) || !FOTOS_CAPABILITY_METHODS[role].every(method => methods.includes(method))) return false;
        return role !== FOTOS_ENRICHMENT || (Array.isArray(candidate.enrichmentModels)
            && candidate.enrichmentModels.some(model => FOTOS_ENRICHMENT_MODELS.includes(model)));
    });
}
