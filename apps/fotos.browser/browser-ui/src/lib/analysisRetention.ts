import {dataAttrsToFaces, EMBEDDING_DIM, FaceClusterDimension, facesToDataAttrs} from '@refinio/fotos.core';
import type {FaceAnalysisResult, FaceClusterInfo} from '@refinio/fotos.core';
import type {FaceInfo, PhotoEntry, SemanticInfo} from '@/types/fotos';

let metadataMutationChain = Promise.resolve();

/** Serialize annotation edits with the final replacement commit, not inference. */
export function queueFaceMetadataMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = metadataMutationChain.then(operation, operation);
    metadataMutationChain = result.then(() => undefined, () => undefined);
    return result;
}

export interface FaceWorkerResult {
    dataAttrs: Record<string, string>;
    cropBlobs: Array<{name: string; blob: Blob}>;
}

function overlap(a: number[], b: number[]): number {
    const intersection = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]))
        * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    return intersection / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - intersection);
}

function hasAnnotation(faces: FaceInfo, index: number): boolean {
    const name = faces.names?.[index]?.trim();
    return Boolean((name && name !== 'Unknown') || faces.personIds?.[index]?.trim());
}

/** Stage a replacement without mutating accepted metadata or cluster membership. */
function stageFaces(photo: PhotoEntry, result: FaceAnalysisResult, dimension: FaceClusterDimension, acceptedPhotos: readonly PhotoEntry[] = []) {
    const old = photo.faces;
    const matches = new Map<number, number>();
    if (old) {
        for (let oldIndex = 0; oldIndex < old.count; oldIndex++) {
            const candidates = result.faces.flatMap((face, index) => overlap(old.bboxes[oldIndex], face.detection.bbox) >= 0.5 ? [index] : []);
            const nextIndex = candidates[0];
            const unique = candidates.length === 1
                && overlap(old.bboxes[oldIndex], result.faces[nextIndex].detection.bbox) >= 0.8
                && old.bboxes.filter(bbox => overlap(bbox, result.faces[nextIndex].detection.bbox) >= 0.5).length === 1;
            if (unique) {
                matches.set(nextIndex, oldIndex);
            } else if (hasAnnotation(old, oldIndex)
                || (dimension.getCluster(old.clusterIds?.[oldIndex] ?? '')?.personName?.trim()
                    && dimension.getCluster(old.clusterIds?.[oldIndex] ?? '')?.personName !== 'Unknown')) {
                throw new Error(`Cannot safely retain the identity of face ${oldIndex + 1} in ${photo.name}; saved analysis retained.`);
            }
        }
    }

    // Remove the predecessor's memberships in a private candidate. Reanalysis must
    // replace memberships, rather than add the same photo to its clusters again.
    const clusters = dimension.getAllClusters().flatMap(cluster => {
        const removed = cluster.members.filter(member => member.photoHash === photo.hash);
        const members = cluster.members.filter(member => member.photoHash !== photo.hash);
        if (members.length === 0) return [];
        if (removed.some(member => !old?.embeddings
            || old.embeddings.length < (member.faceIndex + 1) * EMBEDDING_DIM)) {
            throw new Error(`Cannot replace ${photo.name}: accepted cluster membership has no corresponding embedding; saved analysis retained.`);
        }
        const centroid = cluster.centroid.map((value, index) => (
            value * cluster.members.length - removed.reduce((sum, member) => sum + old!.embeddings![member.faceIndex * EMBEDDING_DIM + index], 0)
        ) / members.length);
        return [{...cluster, centroid, members}];
    });
    let staged = FaceClusterDimension.deserialize(JSON.stringify({threshold: dimension.getThreshold(), clusters}));
    const info: FaceClusterInfo[] = [];
    const candidatePhotoId = `${photo.hash}:analysis:${crypto.randomUUID()}`;
    for (let index = 0; index < result.faces.length; index++) {
        const face = result.faces[index];
        const oldIndex = matches.get(index);
        const retainedId = oldIndex === undefined ? undefined : old?.clusterIds?.[oldIndex];
        const storedName = oldIndex === undefined ? undefined : old?.names?.[oldIndex];
        const name = storedName && storedName !== 'Unknown' ? storedName : retainedId ? dimension.getCluster(retainedId)?.personName : undefined;
        const personId = oldIndex === undefined ? undefined : old?.personIds?.[oldIndex];
        let clusterId: string;
        if (retainedId) {
            const snapshot = staged.getAllClusters().map(cluster => ({...cluster, members: [...cluster.members]}));
            const existing = snapshot.find(cluster => cluster.id === retainedId);
            if (existing) {
                const count = existing.members.length;
                existing.centroid = existing.centroid.map((value, dim) => (value * count + face.embedding[dim]) / (count + 1));
                existing.members.push({photoHash: photo.hash, faceIndex: index});
            } else {
                snapshot.push({id: retainedId, centroid: [...face.embedding], members: [{photoHash: photo.hash, faceIndex: index}]});
            }
            staged = FaceClusterDimension.deserialize(JSON.stringify({threshold: dimension.getThreshold(), clusters: snapshot}));
            clusterId = retainedId;
        } else {
            clusterId = staged.assign(face.embedding, candidatePhotoId, index);
        }
        if (name && name !== 'Unknown') staged.nameCluster(clusterId, name);
        const groupPersonId = acceptedPhotos.flatMap(photo => photo.faces?.clusterIds?.map((id, index) => (
            id === clusterId ? photo.faces?.personIds?.[index]?.trim() : undefined
        )) ?? []).find(Boolean);
        info.push({
            clusterId,
            personName: name && name !== 'Unknown' ? name : staged.getCluster(clusterId)?.personName,
            personId: personId?.trim() || groupPersonId || undefined,
        });
    }
    staged = FaceClusterDimension.deserialize(JSON.stringify({
        threshold: dimension.getThreshold(),
        clusters: staged.getAllClusters().map(cluster => ({
            ...cluster, members: cluster.members.map(member => member.photoHash === candidatePhotoId ? {...member, photoHash: photo.hash} : member),
        })),
    }));
    const prefix = photo.sourcePath?.includes('/') ? `${photo.sourcePath.slice(0, photo.sourcePath.lastIndexOf('/'))}/one/` : 'one/';
    const faces: FaceInfo = {
        count: result.faces.length,
        bboxes: result.faces.map(face => face.detection.bbox),
        scores: result.faces.map(face => face.detection.score),
        embeddings: result.faces.length ? Float32Array.from(result.faces.flatMap(face => face.embedding)) : null,
        crops: result.faces.map(face => face.cropPath ? `${prefix}${face.cropPath}` : ''),
        clusterIds: info.map(cluster => cluster.clusterId),
        names: info.map(cluster => cluster.personName ?? 'Unknown'),
        personIds: info.map(cluster => cluster.personId ?? ''),
    };
    return {faces, dimension: staged, dataAttrs: facesToDataAttrs(result, info)};
}

/** The production commit boundary: failed/interrupted work never publishes empty results. */
export async function replaceFaceAnalysis(options: {
    currentPhoto: () => PhotoEntry;
    dimension: FaceClusterDimension;
    currentDimension?: () => FaceClusterDimension;
    acceptedPhotos?: () => readonly PhotoEntry[];
    commit?: (operation: () => Promise<void>) => Promise<void>;
    analyze: () => Promise<FaceWorkerResult>;
    writeCrops: (crops: FaceWorkerResult['cropBlobs']) => Promise<void>;
    persist: (attrs: Record<string, string>) => Promise<void>;
    publish: (faces: FaceInfo, dimension: FaceClusterDimension) => void;
}): Promise<void> {
    const output = await options.analyze();
    const count = Number(output.dataAttrs['face-count']);
    if (!/^(0|[1-9]\d*)$/.test(output.dataAttrs['face-count'] ?? '') || !Number.isSafeInteger(count)) {
        throw new Error('Face analysis returned an invalid face count; saved analysis retained.');
    }
    const result = dataAttrsToFaces(output.dataAttrs);
    if (result.faces.length !== count || result.faces.some(face => (
        face.embedding.length !== EMBEDDING_DIM || !face.embedding.every(Number.isFinite)
        || !face.embedding.some(value => value !== 0)
        || face.detection.bbox.length !== 4 || !face.detection.bbox.every(Number.isFinite)
        || face.detection.bbox[2] <= face.detection.bbox[0] || face.detection.bbox[3] <= face.detection.bbox[1]
        || !Number.isFinite(face.detection.score)
    ))) throw new Error('Face analysis returned invalid face data; saved analysis retained.');
    // Worker crop names are derived from a truncated image ID. Persist candidate
    // crops under a full generation ID so rejected/interrupted writes cannot
    // overwrite a crop still referenced by accepted analysis.
    const generation = crypto.randomUUID();
    const paths = new Map(output.cropBlobs.map((crop, index) => [crop.name, `faces/${generation}_${index}.jpg`]));
    if (paths.size !== output.cropBlobs.length) throw new Error('Face analysis returned duplicate crop names; saved analysis retained.');
    for (const face of result.faces) {
        if (!face.cropPath) continue;
        const path = paths.get(face.cropPath);
        if (!path) throw new Error('Face analysis omitted a crop; saved analysis retained.');
        face.cropPath = path;
    }
    const crops = output.cropBlobs.map(crop => ({...crop, name: paths.get(crop.name)!}));
    stageFaces(options.currentPhoto(), result, options.currentDimension?.() ?? options.dimension, options.acceptedPhotos?.());
    await options.writeCrops(crops);
    const commit = options.commit ?? (operation => operation());
    await commit(async () => {
        const staged = stageFaces(options.currentPhoto(), result, options.currentDimension?.() ?? options.dimension, options.acceptedPhotos?.());
        await options.persist(staged.dataAttrs);
        options.publish(staged.faces, staged.dimension);
    });
}

export async function replaceSemanticAnalysis(options: {
    analyze: () => Promise<SemanticInfo>;
    persist: (semantic: SemanticInfo) => Promise<void>;
    publish: (semantic: SemanticInfo) => void;
}): Promise<void> {
    const semantic = await options.analyze();
    if (!semantic.modelId?.trim() || semantic.embedding.length === 0
        || !semantic.embedding.every(Number.isFinite) || !semantic.embedding.some(value => value !== 0)) {
        throw new Error('Semantic analysis returned an invalid embedding; saved analysis retained.');
    }
    await options.persist(semantic);
    options.publish(semantic);
}
