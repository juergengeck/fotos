import type {Person} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {getObjectWithType, storeUnversionedObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {ProvenancePlan, type ProvenanceLimits, type ProvenanceObservation, type ProvenanceResource} from '@refinio/provenance.core';
import {createOneProvenanceStorage} from '@refinio/provenance.core/storage-one';
import type {FotosEntry} from './recipes/FotosRecipes.js';
import type {FotosMediaVariant} from './recipes/FotosMediaRecipes.js';
import type {FotosAcquisitionContext, FotosAcquisitionClaim, FotosAcquisitionMethod, FotosAcquisitionPremise} from './recipes/FotosAcquisitionRecipes.js';

export interface RecordFotosAcquisitionParams {
    observer: SHA256IdHash<Person>;
    originalVariant: SHA256Hash<FotosMediaVariant>;
    context: Omit<FotosAcquisitionContext, '$type$' | '$version$'>;
}

/** Record before publishing the owning entry; no exact reference points back to that entry. */
export async function recordFotosAcquisition(params: RecordFotosAcquisitionParams): Promise<SHA256Hash<ProvenanceObservation>> {
    if (!/^[a-f0-9]{64}$/.test(params.observer)) throw new Error('Fotos acquisition requires a canonical observer identity');
    if (!Number.isFinite(params.context.acquiredAt) || params.context.acquiredAt < 0 || !params.context.source.trim()) {
        throw new Error('Fotos acquisition requires an explicit event time and source');
    }
    const variant = await getObjectWithType(params.originalVariant, 'FotosMediaVariant');
    if (variant.role !== 'original') throw new Error('Fotos acquisition requires an original media variant');
    const evidence: ProvenanceResource[] = [{kind: 'object', object: params.originalVariant}];
    if (variant.blob) evidence.push({kind: 'blob', blob: variant.blob});
    const assumptions = new Set<SHA256Hash<FotosAcquisitionPremise>>();
    if (!variant.blob) {
        assumptions.add((await storeUnversionedObject({
            $type$: 'FotosAcquisitionPremise', $version$: '1',
            proposition: 'imported-metadata-corresponds-to-unavailable-original',
        })).hash);
    }
    const claim = await storeUnversionedObject<FotosAcquisitionClaim>({
        $type$: 'FotosAcquisitionClaim', $version$: '1', variant: params.originalVariant,
        kind: variant.blob ? 'bytes-acquired' : 'metadata-imported',
        capture: 'unestablished', authorship: 'unestablished', licensingAuthority: 'unestablished',
    });
    const method = await storeUnversionedObject<FotosAcquisitionMethod>({
        $type$: 'FotosAcquisitionMethod', $version$: '1',
        procedure: variant.blob ? 'retain-original-bytes' : 'import-reported-metadata',
    });
    const context = await storeUnversionedObject<FotosAcquisitionContext>({
        $type$: 'FotosAcquisitionContext', $version$: '1', ...params.context,
    });
    return new ProvenancePlan(createOneProvenanceStorage()).recordObservation({
        claim: claim.hash, observer: params.observer, method: method.hash, context: context.hash,
        evidence, inputs: new Set(), assumptions,
    });
}

/** Explain only the producer-written roots of this selected entry. Older entries have none. */
export async function traceFotosAcquisitions(entry: FotosEntry, limits: ProvenanceLimits) {
    const plan = new ProvenancePlan(createOneProvenanceStorage());
    return Promise.all([...entry.acquisitionObservations ?? []].map(observation => plan.trace({observation, limits})));
}
