import {describe, expect, it} from 'vitest';
import {
    FOTOS_CAPABILITY_METHODS, FOTOS_CAPABILITY_VERSION, FOTOS_ENRICHMENT, FOTOS_ENRICHMENT_MODELS,
    FOTOS_LIBRARY, FOTOS_SHARING, fotosSupplierRoles,
} from './fotos-capabilities.js';

describe('Fotos supplier advertisement', () => {
    it('validates roles, methods, the contract version and supported enrichment models', () => {
        const capable = {version: FOTOS_CAPABILITY_VERSION, methods: FOTOS_CAPABILITY_METHODS,
            enrichmentModels: FOTOS_ENRICHMENT_MODELS};
        expect(fotosSupplierRoles(capable)).toEqual([FOTOS_LIBRARY, FOTOS_ENRICHMENT, FOTOS_SHARING]);
        expect(fotosSupplierRoles({...capable, version: 2})).toEqual([]);
        expect(fotosSupplierRoles({...capable, enrichmentModels: ['unknown']})).toEqual([FOTOS_LIBRARY, FOTOS_SHARING]);
        expect(fotosSupplierRoles({...capable, methods: {[FOTOS_LIBRARY]: ['browse']}})).toEqual([]);
    });
});
